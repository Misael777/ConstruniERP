-- Ticket #112 "PARA EL INGRESO DE APP" (05/11/2026): nueva pantalla de ingreso con
--   1) una frase motivadora distinta cada día del año (las 365 frases que mandó la clienta en el ticket), y
--   2) ingreso rápido con una clave de 4 dígitos o con la huella digital, en vez de escribir correo y contraseña.
--
-- Cómo funciona el ingreso rápido (opcional, lo activa cada usuario al iniciar sesión con su contraseña):
--   - El servidor genera una llave aleatoria por dispositivo y se la entrega una sola vez a la app, que la usa para
--     cifrar (AES-GCM) la contraseña y guardarla en el equipo. La app NO guarda la llave.
--   - Para volver a ingresar, la app manda la clave de 4 dígitos; si es correcta el servidor devuelve la llave, la app
--     descifra la contraseña e inicia sesión normal (signInWithPassword). Con 5 claves erradas seguidas el acceso
--     rápido de ese dispositivo se borra y hay que entrar con la contraseña.
--   - Con huella (Android) la llave queda además cifrada con una clave del Keystore que solo se abre con la huella.
--   - Quien copie los datos del equipo no puede probar las 10 000 claves: el conteo de intentos está en el servidor.
--   - Si la contraseña cambia, el ingreso rápido falla y la app pide la contraseña de nuevo.
-- Tablas nuevas, sin tocar datos existentes. Idempotente.

CREATE TABLE IF NOT EXISTS public.frase_motivadora (
    dia smallint PRIMARY KEY CHECK (dia BETWEEN 1 AND 366),
    frase text NOT NULL,
    autor text
);
ALTER TABLE public.frase_motivadora ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.frase_motivadora FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.acceso_rapido (
    id_dispositivo uuid PRIMARY KEY,
    auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pin_hash text NOT NULL,
    llave text NOT NULL,
    intentos smallint NOT NULL DEFAULT 0,
    creado_en timestamptz NOT NULL DEFAULT now(),
    usado_en timestamptz
);
CREATE INDEX IF NOT EXISTS acceso_rapido_usuario_idx ON public.acceso_rapido (auth_user_id);
ALTER TABLE public.acceso_rapido ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo se usa por las funciones de abajo.
REVOKE ALL ON public.acceso_rapido FROM anon, authenticated;

-- Frase del día (hora de Lima). Se lee antes de iniciar sesión, por eso también la puede llamar anon.
CREATE OR REPLACE FUNCTION public.fn_frase_del_dia()
RETURNS TABLE (frase text, autor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT f.frase, f.autor
    FROM frase_motivadora f
    WHERE f.dia = LEAST(EXTRACT(DOY FROM (now() AT TIME ZONE 'America/Lima'))::int, (SELECT max(dia) FROM frase_motivadora));
$$;

-- Activa (o reemplaza) el ingreso rápido de este dispositivo para el usuario con sesión. Devuelve la llave.
CREATE OR REPLACE FUNCTION public.fn_acceso_rapido_activar(p_dispositivo uuid, p_pin text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_llave text := encode(gen_random_bytes(32), 'base64');
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión para activar el ingreso rápido.'; END IF;
    IF p_dispositivo IS NULL OR p_pin IS NULL OR p_pin !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'La clave debe tener 4 dígitos.';
    END IF;
    INSERT INTO acceso_rapido (id_dispositivo, auth_user_id, pin_hash, llave)
    VALUES (p_dispositivo, auth.uid(), crypt(p_pin, gen_salt('bf', 8)), v_llave)
    ON CONFLICT (id_dispositivo) DO UPDATE
        SET auth_user_id = EXCLUDED.auth_user_id, pin_hash = EXCLUDED.pin_hash, llave = EXCLUDED.llave,
            intentos = 0, creado_en = now(), usado_en = NULL;
    RETURN v_llave;
END $$;

-- Comprueba la clave de 4 dígitos. No lanza errores (un error desharía el conteo de intentos): devuelve
-- {ok:true, llave} | {ok:false, motivo:'clave', restantes} | {ok:false, motivo:'bloqueado'} | {ok:false, motivo:'no_existe'}.
CREATE OR REPLACE FUNCTION public.fn_acceso_rapido_abrir(p_dispositivo uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v acceso_rapido;
    c_max constant int := 5;
BEGIN
    SELECT * INTO v FROM acceso_rapido WHERE id_dispositivo = p_dispositivo FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'no_existe'); END IF;
    IF p_pin ~ '^[0-9]{4}$' AND v.pin_hash = crypt(p_pin, v.pin_hash) THEN
        UPDATE acceso_rapido SET intentos = 0, usado_en = now() WHERE id_dispositivo = p_dispositivo;
        RETURN jsonb_build_object('ok', true, 'llave', v.llave);
    END IF;
    IF v.intentos + 1 >= c_max THEN
        DELETE FROM acceso_rapido WHERE id_dispositivo = p_dispositivo;
        RETURN jsonb_build_object('ok', false, 'motivo', 'bloqueado');
    END IF;
    UPDATE acceso_rapido SET intentos = intentos + 1 WHERE id_dispositivo = p_dispositivo;
    RETURN jsonb_build_object('ok', false, 'motivo', 'clave', 'restantes', c_max - v.intentos - 1);
END $$;

-- Para la huella: la llave ya está en el equipo (cifrada con la huella). Solo confirma que el acceso rápido de este
-- dispositivo sigue vigente (no fue bloqueado ni reemplazado) y registra el uso.
CREATE OR REPLACE FUNCTION public.fn_acceso_rapido_vigente(p_dispositivo uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE acceso_rapido SET usado_en = now(), intentos = 0 WHERE id_dispositivo = p_dispositivo;
    RETURN FOUND;
END $$;

-- "Cambiar cuenta" / quitar el ingreso rápido de este equipo. El id del dispositivo es un uuid aleatorio que solo
-- conoce ese equipo.
CREATE OR REPLACE FUNCTION public.fn_acceso_rapido_quitar(p_dispositivo uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM acceso_rapido WHERE id_dispositivo = p_dispositivo;
$$;

REVOKE ALL ON FUNCTION public.fn_frase_del_dia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_acceso_rapido_activar(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_acceso_rapido_abrir(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_acceso_rapido_vigente(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_acceso_rapido_quitar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_frase_del_dia() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acceso_rapido_activar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acceso_rapido_abrir(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acceso_rapido_vigente(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_acceso_rapido_quitar(uuid) TO anon, authenticated;

-- Las 365 frases del ticket #112 (día del año → frase, autor). Día 366 (año bisiesto) usa la del 365.
INSERT INTO public.frase_motivadora (dia, frase, autor) VALUES
    (1, 'Dios sostiene tus pasos.', 'Anónimo'),
    (2, 'Piensa diferente.', 'Steve Jobs'),
    (3, 'Su gracia te basta.', 'San Pablo'),
    (4, 'Ama y haz lo que quieras.', 'San Agustín'),
    (5, 'Cristo es tu paz.', 'Anónimo'),
    (6, 'La innovación distingue a un líder de un seguidor.', 'Steve Jobs'),
    (7, 'La oración lo cambia todo.', 'Anónimo'),
    (8, 'La fe es dar el primer paso incluso cuando no ves toda la escalera.', 'Martin Luther King Jr.'),
    (9, 'Con Dios nada es imposible.', 'Evangelio de San Lucas'),
    (10, 'Haz las cosas pequeñas con un gran amor.', 'Santa Teresa de Calcuta'),
    (11, 'Confía, Él tiene el control.', 'Anónimo'),
    (12, 'La simplicidad es la máxima sofisticación.', 'Leonardo da Vinci'),
    (13, 'La esperanza no defrauda.', 'San Pablo'),
    (14, 'El único modo de hacer un gran trabajo es amar lo que haces.', 'Steve Jobs'),
    (15, 'Su amor nunca falla.', 'Anónimo'),
    (16, 'Sé el cambio que quieres ver en el mundo.', 'Mahatma Gandhi'),
    (17, 'Camina de la mano de Dios.', 'Anónimo'),
    (18, 'La paz empieza con una sonrisa.', 'Santa Teresa de Calcuta'),
    (19, 'El Señor es tu refugio.', 'Salmos'),
    (20, 'La verdad os hará libres.', 'Jesús de Nazaret'),
    (21, 'Dios renueva tus fuerzas.', 'Isaías'),
    (22, 'Tu tiempo es limitado, no lo malgastes viviendo la vida de otro.', 'Steve Jobs'),
    (23, 'Ama como Jesús amó.', 'Anónimo'),
    (24, 'En el corazón de cada hombre hay un vacío con la forma de Dios.', 'Blaise Pascal'),
    (25, 'Jesús vive y te ama.', 'Anónimo'),
    (26, 'Empieza donde estás, usa lo que tienes.', 'Arthur Ashe'),
    (27, 'Dios borra todo miedo.', 'Anónimo'),
    (28, 'La oscuridad no puede expulsar a la oscuridad; solo la luz puede hacer eso.', 'Martin Luther King Jr.'),
    (29, 'Camina con fe, no por vista.', 'San Pablo'),
    (30, 'Quien a Dios tiene, nada le falta. Solo Dios basta.', 'Santa Teresa de Jesús'),
    (31, 'La luz brilla en las tinieblas.', 'Evangelio de San Juan'),
    (32, 'Mantente hambriento, mantente alocado.', 'Steve Jobs'),
    (33, 'Dios guarda tus salidas y entradas.', 'Salmos'),
    (34, 'La medida del amor es amar sin medida.', 'San Bernardo de Claraval'),
    (35, 'Su presencia es tu descanso.', 'Anónimo'),
    (36, 'Cae siete veces y levántate ocho.', 'Proverbio Japonés'),
    (37, 'Dios hace nuevas todas las cosas.', 'Apocalipsis'),
    (38, 'La alegría de hacer el bien es la única felicidad verdadera.', 'León Tolstói'),
    (39, 'El Señor escucha tu clamor.', 'Salmos'),
    (40, 'Lo que hacemos en la vida tiene su eco en la eternidad.', 'Marco Aurelio'),
    (41, 'Tu auxilio viene del Señor.', 'Salmos'),
    (42, 'No busques el éxito, busca ser de valor.', 'Albert Einstein'),
    (43, 'Santificar el trabajo, santificarse en el trabajo y santificar con el trabajo.', 'San Josemaría Escrivá'),
    (44, 'Dios no nos llama a ser exitosos, sino a ser fieles.', 'Santa Teresa de Calcuta'),
    (45, 'En la cruz hay victoria.', 'Anónimo'),
    (46, 'Intenta ser un arcoíris en la nube de alguien.', 'Maya Angelou'),
    (47, 'Donde hay fe, hay esperanza.', 'Anónimo'),
    (48, 'La mejor manera de predecir el futuro es crearlo.', 'Peter Drucker'),
    (49, 'El trabajo no es un castigo, sino una colaboración con Dios.', 'Enrique Shaw'),
    (50, 'No hay sustituto para el trabajo duro.', 'Thomas Edison'),
    (51, 'Si Dios está con nosotros, ¿quién contra nosotros?', 'San Pablo'),
    (52, 'Con Dios, el futuro siempre es mejor.', 'Anónimo'),
    (53, 'La vida es lo que pasa mientras haces otros planes.', 'John Lennon'),
    (54, 'El Espíritu Santo te guía.', 'Anónimo'),
    (55, 'Lo que no te mata te hace más fuerte.', 'Friedrich Nietzsche'),
    (56, 'Permanece en su amor.', 'Evangelio de San Juan'),
    (57, 'La oración es el encuentro del sediento con la fuente.', 'San Agustín'),
    (58, 'Dios es tu refugio seguro.', 'Salmos'),
    (59, 'Sé luz en la oscuridad.', 'Anónimo'),
    (60, 'Dios siempre llega a tiempo.', 'Anónimo'),
    (61, 'Dios abre caminos donde no los hay.', 'Anónimo'),
    (62, 'El coraje es la gracia bajo presión.', 'Ernest Hemingway'),
    (63, 'El Amor no es amado.', 'San Francisco de Asís'),
    (64, 'Mantén tus ojos en las estrellas y tus pies en la tierra.', 'Theodore Roosevelt'),
    (65, 'Haz lo que debes y está en lo que haces.', 'San Josemaría Escrivá'),
    (66, 'La felicidad depende de nosotros mismos.', 'Aristóteles'),
    (67, 'Cristo vive en mi corazón.', 'San Pablo'),
    (68, 'No cuentes los días, haz que los días cuenten.', 'Muhammad Ali'),
    (69, 'Su gracia transforma la debilidad.', 'Anónimo'),
    (70, 'La única limitación es la que pones en tu propia mente.', 'Napoleon Hill'),
    (71, 'Tu fe es tu escudo.', 'San Pablo'),
    (72, 'Nada grandioso se logra sin entusiasmo.', 'Ralph Waldo Emerson'),
    (73, 'La paz de Dios supera todo entendimiento.', 'San Pablo'),
    (74, 'Lo que no se da, se pierde.', 'Dominique Lapierre'),
    (75, 'Dios es luz y no hay tinieblas en Él.', 'San Juan'),
    (76, 'Sigue caminando, tu momento llegará.', 'C.S. Lewis'),
    (77, 'El perdón libera el alma.', 'Nelson Mandela'),
    (78, 'Siembra hoy con esperanza para cosechar mañana en Dios.', 'Anónimo'),
    (79, 'Detrás de cada proyecto y tarea hay una vida humana.', 'Enrique Shaw'),
    (80, 'Sé el maestro de tu destino, el capitán de tu alma.', 'William Ernest Henley'),
    (81, 'Dios camina a tu ritmo.', 'Anónimo'),
    (82, 'La vida empieza al final de tu zona de confort.', 'Neale Donald Walsch'),
    (83, 'Su amor borra las culpas.', 'Anónimo'),
    (84, 'No importa cuán lento vayas, siempre y cuando no te detengas.', 'Confucio'),
    (85, 'El Señor renueva tus fuerzas.', 'Isaías'),
    (86, 'Cree que puedes y casi estarás allí.', 'Theodore Roosevelt'),
    (87, 'Que tu vida no sea una vida estéril. Sé útil. Deja huella.', 'San Josemaría Escrivá'),
    (88, 'La paciencia es la clave del triunfo.', 'Walt Disney'),
    (89, 'Dios bendice al corazón humilde.', 'Proverbios'),
    (90, 'Un viaje de mil millas comienza con un solo paso.', 'Lao Tsé'),
    (91, 'Todo coopera para el bien de los que aman a Dios.', 'San Pablo'),
    (92, 'Lo imposible solo tarda un poco más.', 'Fridtjof Nansen'),
    (93, 'La esperanza es el ancla del alma.', 'Hebreos'),
    (94, 'El éxito es la suma de pequeños esfuerzos repetidos día tras día.', 'Robert Collier'),
    (95, 'El trabajo profesional es también oración.', 'San Josemaría Escrivá'),
    (96, 'Sé amable, porque cada persona libra una gran batalla.', 'Platón'),
    (97, 'Tu vida es un regalo de Dios.', 'Anónimo'),
    (98, 'Si puedes soñarlo, puedes hacerlo.', 'Walt Disney'),
    (99, 'La gloria de Dios es el hombre vivo.', 'San Ireneo'),
    (100, 'Busca primero el Reino de Dios y su justicia.', 'Jesús de Nazaret'),
    (101, 'Dios es tu fortaleza y tu escudo.', 'Salmos'),
    (102, 'La disciplina es el puente entre metas y logros.', 'Jim Rohn'),
    (103, 'El trabajo ennoblece cuando se ofrece con amor.', 'Enrique Shaw'),
    (104, 'El conocimiento habla, pero la sabiduría escucha.', 'Jimi Hendrix'),
    (105, 'En la quietud de la fe hallas descanso.', 'Anónimo'),
    (106, 'Actúa como si lo que haces marcara la diferencia.', 'William James'),
    (107, 'La gracia de Dios multiplica lo poco que entregas.', 'Anónimo'),
    (108, 'Siempre parece imposible hasta que se hace.', 'Nelson Mandela'),
    (109, 'Trabajar juntos es servir y construir para los demás.', 'Enrique Shaw'),
    (110, 'Quien camina en integridad avanza con firmeza.', 'Proverbios'),
    (111, 'No hay noche tan larga que impida el amanecer.', 'Proverbio'),
    (112, 'El entusiasmo mueve las ruedas del progreso.', 'Henry Ford'),
    (113, 'Deja que la paz de Cristo reine en tu hogar.', 'Colosenses'),
    (114, 'La excelencia no es un acto, es un hábito.', 'Aristóteles'),
    (115, 'Dios escucha la voz del corazón afligido.', 'Salmos'),
    (116, 'Quien tiene un porqué puede soportar cualquier cómo.', 'Viktor Frankl'),
    (117, 'La paciencia produce fruto a su debido tiempo.', 'Gálatas'),
    (118, 'Soñad y os quedaréis cortos.', 'San Josemaría Escrivá'),
    (119, 'Jesús sana lo que la prisa destruye.', 'Anónimo'),
    (120, 'La huella que dejas es el legado que perdura.', 'Anónimo'),
    (121, 'Quien confía en la providencia nunca queda desamparado.', 'Anónimo'),
    (122, 'La verdadera grandeza reside en el servicio humilde.', 'Jesús de Nazaret'),
    (123, 'Poned a Cristo en lo alto de todas las actividades humanas.', 'San Josemaría Escrivá'),
    (124, 'Cada día es una nueva oportunidad para empezar de nuevo.', 'Anónimo'),
    (125, 'La fe consiste en perseverar en la penumbra.', 'Anónimo'),
    (126, 'La generosidad enriquece más al que da que al que recibe.', 'Anónimo'),
    (127, 'En la sencillez de tu trabajo ordinario está la grandeza de Dios.', 'San Josemaría Escrivá'),
    (128, 'El amor todo lo disculpa, todo lo cree, todo lo espera.', 'San Pablo'),
    (129, 'Sé valiente, porque el Señor camina delante de ti.', 'Deuteronomio'),
    (130, 'El perdón abre senderos de paz en el alma.', 'Anónimo'),
    (131, 'Cada trabajador es un servidor de la comunidad.', 'Enrique Shaw'),
    (132, 'Ningún esfuerzo sincero queda en el olvido.', 'Anónimo'),
    (133, 'La verdad abre puertas que la mentira cierra.', 'Anónimo'),
    (134, 'Siembra semillas de esperanza en cada jornada.', 'Anónimo'),
    (135, 'Unidos por el trabajo y la fe, construimos un mundo mejor.', 'Enrique Shaw'),
    (136, 'Dios guía tus pasos aun en caminos estrechos.', 'Anónimo'),
    (137, 'Mantén firme la mirada en lo que trasciende.', 'Anónimo'),
    (138, 'La humildad atrae la gracia del Creador.', 'Santiago'),
    (139, 'La alegría que nace de la fe permanece.', 'Anónimo'),
    (140, 'El trabajo bien hecho honra al Padre celestial.', 'Anónimo'),
    (141, 'Dios transforma tu desierto en manantial.', 'Isaías'),
    (142, 'No he fracasado, he encontrado 10.000 formas que no funcionan.', 'Thomas Edison'),
    (143, 'La fe no quita los problemas, te da fuerzas para vencerlos.', 'Anónimo'),
    (144, 'Un amigo de todos es un amigo de nadie.', 'Aristóteles'),
    (145, 'El amor todo lo soporta.', 'San Pablo'),
    (146, 'Persevera en el cumplimiento del deber de cada instante.', 'San Josemaría Escrivá'),
    (147, 'En la presencia del Señor hay plenitud de gozo.', 'Salmos'),
    (148, 'El secreto para salir adelante es empezar.', 'Mark Twain'),
    (149, 'María guarda todas estas cosas en su corazón.', 'Evangelio de San Lucas'),
    (150, 'Haz de cada día tu obra maestra.', 'John Wooden'),
    (151, 'La salvación viene de nuestro Dios.', 'Apocalipsis'),
    (152, 'Todo lo que puedes imaginar es real.', 'Pablo Picasso'),
    (153, 'Dios conoce cada fibra de tu ser.', 'Salmos'),
    (154, 'Para el cristiano no hay tareas insignificantes.', 'San Josemaría Escrivá'),
    (155, 'La esperanza es la luz que no se apaga.', 'Anónimo'),
    (156, 'Prefiero morir de pasión que de aburrimiento.', 'Vincent van Gogh'),
    (157, 'Jesús es el camino, la verdad y la vida.', 'Evangelio de San Juan'),
    (158, 'No cuentes los días, haz que cada día cuente.', 'Muhammad Ali'),
    (159, 'La labor diaria debe estar guiada por la caridad y la unión.', 'Enrique Shaw'),
    (160, 'Donde hay amor, hay vida.', 'Mahatma Gandhi'),
    (161, 'Dios redime tu historia.', 'Anónimo'),
    (162, 'Lo que pienses, lo serás. Lo que sientas, lo atraerás.', 'Buda'),
    (163, 'La oración del justo es poderosa y eficaz.', 'Santiago'),
    (164, 'La vida es 10% lo que te ocurre y 90% cómo reaccionas.', 'Charles R. Swindoll'),
    (165, 'El Señor es tu protector.', 'Salmos'),
    (166, 'Si dices la verdad, no tienes que recordar nada.', 'Mark Twain'),
    (167, 'La paz de Cristo supera todo entendimiento.', 'San Pablo'),
    (168, 'No juzgues cada día por la cosecha, sino por las semillas que plantas.', 'Robert Louis Stevenson'),
    (169, 'Camina con humildad ante tu Dios.', 'Miqueas'),
    (170, 'La única forma de hacer un trabajo genial es amar lo que haces.', 'Steve Jobs'),
    (171, 'Dios restaura tus años perdidos.', 'Joel'),
    (172, 'No podemos ayudar a todos, pero todos pueden ayudar a alguien.', 'Ronald Reagan'),
    (173, 'Su bondad te persigue cada día.', 'Salmos'),
    (174, 'La alegría es la red de amor con la que puedes pescar almas.', 'Santa Teresa de Calcuta'),
    (175, 'El Espíritu otorga vida y libertad.', 'San Pablo'),
    (176, 'Haz lo que puedas, con lo que tengas, donde estés.', 'Theodore Roosevelt'),
    (177, 'La cruz nos enseña a amar de verdad.', 'Anónimo'),
    (178, 'La imaginación es más importante que el conocimiento.', 'Albert Einstein'),
    (179, 'Dios enjugará toda lágrima.', 'Apocalipsis'),
    (180, 'Señor, hazme un instrumento de tu paz.', 'San Francisco de Asís'),
    (181, 'Dios fortalece tus manos para la batalla.', 'Salmos'),
    (182, 'La esperanza es ver luz en medio de las tinieblas.', 'Desmond Tutu'),
    (183, 'Su providencia nunca se agota.', 'Anónimo'),
    (184, 'Convierte tus heridas en sabiduría.', 'Oprah Winfrey'),
    (185, 'En el trabajo diario se santifica el hombre y la sociedad.', 'Enrique Shaw'),
    (186, 'Quien no vive para servir, no sirve para vivir.', 'San Antonio de Padua'),
    (187, 'La verdad divina permanece para siempre.', 'Salmos'),
    (188, 'El único límite a nuestros logros de mañana son las dudas de hoy.', 'Franklin D. Roosevelt'),
    (189, 'Camina ligero, deja tu carga en la cruz.', 'Anónimo'),
    (190, 'No encuentres el fallo, encuentra el remedio.', 'Henry Ford'),
    (191, 'La misericordia de Dios sana la culpa.', 'Anónimo'),
    (192, 'Un día sin sonreír es un día perdido.', 'Charlie Chaplin'),
    (193, 'Jesús limpia el alma de todo temor.', 'Anónimo'),
    (194, 'El optimismo es la fe que conduce al logro.', 'Helen Keller'),
    (195, 'Busca a Dios en lo cotidiano.', 'San Josemaría Escrivá'),
    (196, 'Ninguna obra de amor, por pequeña que sea, se pierde.', 'Esopo'),
    (197, 'La gracia abre los ojos del corazón.', 'Anónimo'),
    (198, 'Conoce la verdad y serás libre.', 'San Agustín'),
    (199, 'El Señor guía tus pasos en la tormenta.', 'Salmos'),
    (200, 'El propósito de la vida es una vida con propósito.', 'Robert Byrne'),
    (201, 'La paz de Dios es un ancla firme.', 'Anónimo'),
    (202, 'No hay distancia que el amor no alcance.', 'Anónimo'),
    (203, 'En la oración encuentras respuesta y consuelo.', 'Anónimo'),
    (204, 'Sé fiel en lo poco y se te confiará lo mucho.', 'Evangelio de San Mateo'),
    (205, 'El amor todo lo ilumina.', 'Anónimo'),
    (206, 'Cada amanecer demuestra la fidelidad de Dios.', 'Lamentaciones'),
    (207, 'La gratitud convierte lo ordinario en bendición.', 'Anónimo'),
    (208, 'Mantén encendida la lámpara de tu fe.', 'Anónimo'),
    (209, 'La humildad eleva el espíritu.', 'Proverbios'),
    (210, 'Con Dios siempre hay un nuevo comienzo.', 'Anónimo'),
    (211, 'La bondad es reflejo de la presencia divina.', 'Anónimo'),
    (212, 'Confía en que el Creador prepara tu camino.', 'Anónimo'),
    (213, 'El silencio en oración cultiva la paz interior.', 'Anónimo'),
    (214, 'Quien siembra esperanza cosechará alegría.', 'Anónimo'),
    (215, 'Dios guarda tu entrada y tu salida hoy y siempre.', 'Salmos'),
    (216, 'La fe sostiene lo que los ojos no ven.', 'Hebreos'),
    (217, 'Ama sin esperar nada a cambio.', 'Jesús de Nazaret'),
    (218, 'El perdón rompe las cadenas del alma.', 'Anónimo'),
    (219, 'Tu vida es reflejo del amor celestial.', 'Anónimo'),
    (220, 'Permanece firme en la verdad de Cristo.', 'Anónimo'),
    (221, 'La alegría del Señor es tu fuerza.', 'Nehemías'),
    (222, 'La belleza salvará al mundo.', 'Fiódor Dostoyevski'),
    (223, 'Dios es más grande que cualquier prueba.', 'Anónimo'),
    (224, 'La puerta de la oración está siempre abierta.', 'Anónimo'),
    (225, 'La gloria de Dios es el hombre plenamente vivo.', 'San Ireneo'),
    (226, 'El amor no quita nada, lo da todo.', 'Benedicto XVI'),
    (227, 'La esperanza ve lo invisible y logra lo imposible.', 'Anónimo'),
    (228, 'Sé la voz de los que no tienen voz.', 'Proverbios'),
    (229, 'En la humildad habita la sabiduría.', 'Proverbios'),
    (230, 'El alma que camina en amor no cansa ni se cansa.', 'San Juan de la Cruz'),
    (231, 'El Señor cuida de los sencillos.', 'Salmos'),
    (232, 'Lo importante no es lo que miras, sino lo que ves.', 'Henry David Thoreau'),
    (233, 'Donde está tu hermano, tu trabajo y tu afán, ahí está Cristo.', 'San Josemaría Escrivá'),
    (234, 'La paz es el fruto de la justicia y del amor.', 'San Juan Pablo II'),
    (235, 'La luz de Cristo ilumina tus sombras.', 'Anónimo'),
    (236, 'El coraje no es la ausencia de miedo, sino el triunfo sobre él.', 'Nelson Mandela'),
    (237, 'En las manos del Alfarero tu vida toma forma.', 'Jeremías'),
    (238, 'Dios nunca se cansa de perdonar.', 'Papa Francisco'),
    (239, 'La gratitud abre las puertas del cielo.', 'Anónimo'),
    (240, 'Cada santo tiene un pasado y cada pecador un futuro.', 'Oscar Wilde'),
    (241, 'Quien a Dios tiene, nada le falta.', 'Santa Teresa de Jesús'),
    (242, 'La medida del amor es amar sin medida.', 'San Agustín'),
    (243, 'Sé firme en la fe, constante en la oración.', 'Anónimo'),
    (244, 'Donde no hay amor, pon amor y sacarás amor.', 'San Juan de la Cruz'),
    (245, 'La bendición de Dios permanece para siempre.', 'Salmos'),
    (246, 'El misterio del amor es más grande que el misterio de la muerte.', 'Oscar Wilde'),
    (247, 'La oración es la llave de la mañana y el candado de la noche.', 'Mahatma Gandhi'),
    (248, 'Camina en libertad, sin cadenas en el alma.', 'Anónimo'),
    (249, 'El Señor sostiene a los que caen.', 'Salmos'),
    (250, 'Nada te turbe, nada te espante.', 'Santa Teresa de Jesús'),
    (251, 'La misericordia transforma el corazón más duro.', 'Papa Francisco'),
    (252, 'El secreto de la paz es el abandono en Dios.', 'Anónimo'),
    (253, 'Quien da con alegría, recibe el doble.', '2 Corintios'),
    (254, 'El amor supera todo entendimiento humano.', 'Anónimo'),
    (255, 'Tu ayuda viene del Creador del cielo y de la tierra.', 'Salmos'),
    (256, 'Ninguna tempestad destruye la casa edificada sobre roca.', 'Evangelio de San Mateo'),
    (257, 'En la sencillez se revela la grandeza de Dios.', 'Anónimo'),
    (258, 'El perdón redime la culpa y restaura la vida.', 'Anónimo'),
    (259, 'Mantén tus ojos fijos en Jesús.', 'Hebreos'),
    (260, 'Dios guía tus pasos por senderos de paz.', 'Salmos'),
    (261, 'Dios convierte tus lágrimas en alegría.', 'Salmos'),
    (262, 'No hay lugar demasiado oscuro para la luz de Dios.', 'Anónimo'),
    (263, 'La fe es la certeza de lo que se espera.', 'San Pablo'),
    (264, 'El bien que hagas hoy perdura para siempre.', 'Anónimo'),
    (265, 'En la debilidad, la fuerza de Dios se perfecciona.', '2 Corintios'),
    (266, 'No te preocupes por el mañana, cada día tiene su propio afán.', 'Jesús de Nazaret'),
    (267, 'La paz interior comienza cuando confías plenamente en Dios.', 'Anónimo'),
    (268, 'El amor verdadero busca el bien del otro.', 'San Tomás de Aquino'),
    (269, 'Dios renueva tu espíritu día tras día.', '2 Corintios'),
    (270, 'La oración constante fortalece el alma fatigada.', 'Anónimo'),
    (271, 'Camina con la cabeza en el cielo y los pies en la tierra.', 'San Juan Bosco'),
    (272, 'La esperanza es el faro que guía en la tormenta.', 'Anónimo'),
    (273, 'El perdón es el regalo que te das a ti mismo.', 'Anónimo'),
    (274, 'Quien confía en el Señor no será defraudado.', 'Salmos'),
    (275, 'Haz el bien sin mirar a quién.', 'Proverbio'),
    (276, 'La presencia de Dios es tu mayor amparo.', 'Salmos'),
    (277, 'La paciencia todo lo alcanza.', 'Santa Teresa de Jesús'),
    (278, 'Sé luz donde haya oscuridad y paz donde haya conflicto.', 'San Francisco de Asís'),
    (279, 'El corazón humilde atrae la gracia del Señor.', 'Santiago'),
    (280, 'La verdad siempre prevalece sobre el engaño.', 'Anónimo'),
    (281, 'Dios prepara bendiciones que ni te imaginas.', '1 Corintios'),
    (282, 'La vida es un regalo para compartir con amor.', 'Anónimo'),
    (283, 'Permanece constante en la fe ante la adversidad.', 'Anónimo'),
    (284, 'El Señor rescata al angustiado de todas sus penas.', 'Salmos'),
    (285, 'Tu alegría inspira a quienes te rodean.', 'Anónimo'),
    (286, 'La oración es el alimento diario del alma.', 'Anónimo'),
    (287, 'Dios nunca llega tarde, su tiempo es perfecto.', 'Anónimo'),
    (288, 'En la entrega sincera hallas la verdadera libertad.', 'Anónimo'),
    (289, 'La misericordia de Dios no tiene fronteras.', 'Papa Francisco'),
    (290, 'Quien camina con Dios jamás camina solo.', 'Anónimo'),
    (291, 'Su Palabra es lámpara a tus pies y luz a tu camino.', 'Salmos'),
    (292, 'El amor es la fuerza más poderosa del universo.', 'Martin Luther King Jr.'),
    (293, 'Dios restaura la esperanza en los corazones rotos.', 'Salmos'),
    (294, 'Sé fuerte y valiente, el Señor está contigo.', 'Josué'),
    (295, 'La paz no es ausencia de problemas, es presencia de Dios.', 'Anónimo'),
    (296, 'Cada día es una oportunidad para volver a empezar.', 'Anónimo'),
    (297, 'En la gratitud encuentras la llave de la abundancia.', 'Anónimo'),
    (298, 'El Señor guarda tu alma de todo mal.', 'Salmos'),
    (299, 'La fe nos hace ver más allá de nuestras fronteras.', 'Anónimo'),
    (300, 'Pon a Dios en el centro de tu vida y nada te faltará.', 'Anónimo'),
    (301, 'El amor expulsa el temor.', '1 San Juan'),
    (302, 'La simplicidad y la pureza son las dos alas para volar a Dios.', 'Tomás de Kempis'),
    (303, 'Dios conoce el camino antes de que tú des el paso.', 'Anónimo'),
    (304, 'Sé fiel a lo pequeño si quieres crecer en lo grande.', 'San Jerónimo'),
    (305, 'El descanso de la mente es la meditación en Dios.', 'Anónimo'),
    (306, 'No hay carga tan pesada que la gracia no pueda aliviar.', 'Anónimo'),
    (307, 'El corazón agradecido es un imán para las bendiciones.', 'Anónimo'),
    (308, 'Dios es amor, y el que permanece en amor permanece en Dios.', '1 San Juan'),
    (309, 'La humildad es la raíz de todas las virtudes.', 'San Bernardo'),
    (310, 'Tu actitud ante la prueba define tu victoria.', 'Anónimo'),
    (311, 'La fe ve lo invisible, cree lo increíble y recibe lo imposible.', 'Anónimo'),
    (312, 'Ama la verdad y vive con sencillez.', 'Anónimo'),
    (313, 'Dios consuela a los humildes de corazón.', '2 Corintios'),
    (314, 'El perdón sana la memoria del dolor.', 'Anónimo'),
    (315, 'En la paciencia poseeréis vuestras almas.', 'Evangelio de San Lucas'),
    (316, 'Donde abunda la gracia, la esperanza florece.', 'Anónimo'),
    (317, 'Una hora de estudio o trabajo bien hecho es una hora de oración.', 'San Josemaría Escrivá'),
    (318, 'Dios sostiene la creación con la fuerza de su amor.', 'Anónimo'),
    (319, 'Camina en santidad y hallarás paz duradera.', 'Anónimo'),
    (320, 'El consuelo del Señor refresca la mente cansada.', 'Salmos'),
    (321, 'La alegría cristiana nace de la certeza de ser amado por Dios.', 'Papa Benedicto XVI'),
    (322, 'Sé el consuelo de alguien en su momento de aflicción.', 'Anónimo'),
    (323, 'Dios multiplica tu fe cuando compartes tu pan.', 'Anónimo'),
    (324, 'La serenidad del alma es don del Espíritu.', 'Anónimo'),
    (325, 'Basta a cada día su propio afán.', 'Evangelio de San Mateo'),
    (326, 'La sabiduría comienza con el temor y respeto al Señor.', 'Proverbios'),
    (327, 'El Amor vence siempre la indiferencia.', 'San Juan Pablo II'),
    (328, 'Dios llena las manos de quien sabe soltar el rencor.', 'Anónimo'),
    (329, 'Tu fe te ha salvado; ve en paz.', 'Evangelio de San Lucas'),
    (330, 'La luz de una sola vela puede disipar mil tinieblas.', 'San Francisco de Asís'),
    (331, 'En el servicio desinteresado hallas la verdadera alegría.', 'Santa Teresa de Calcuta'),
    (332, 'Dios prepara un banquete de bendición para sus hijos.', 'Salmos'),
    (333, 'La perseverancia produce carácter probado.', 'Romanos'),
    (334, 'Quien vive en la verdad camina a plena luz.', 'Anónimo'),
    (335, 'Dios guarda tus lágrimas en su copa de compasión.', 'Salmos'),
    (336, 'La paz verdadera es fruto de la unión con Dios.', 'Anónimo'),
    (337, 'Siembra justicia y cosecharás misericordia.', 'Oseas'),
    (338, 'El tiempo dedicado a Dios nunca se pierde.', 'San Pío de Pietrelcina'),
    (339, 'Jesús es el buen pastor que da la vida por sus ovejas.', 'Evangelio de San Juan'),
    (340, 'La belleza de la fe resplandece en las buenas obras.', 'Anónimo'),
    (341, 'Dios ilumina tus noches más oscuras con su promesa.', 'Anónimo'),
    (342, 'El Señor guarda a los que lo aman.', 'Salmos'),
    (343, 'Confía en el Señor de todo corazón y no en tu propia prudencia.', 'Proverbios'),
    (344, 'La esperanza renace cada mañana con la salida del sol.', 'Anónimo'),
    (345, 'En la eucaristía hallas el verdadero pan de vida.', 'Jesús de Nazaret'),
    (346, 'La fe es el faro que orienta la vida en la tempestad.', 'Anónimo'),
    (347, 'Dios te ha llamado por tu nombre; eres suyo.', 'Isaías'),
    (348, 'El amor de Dios ha sido derramado en nuestros corazones.', 'Romanos'),
    (349, 'Sé compasivo como tu Padre celestial es compasivo.', 'Evangelio de San Lucas'),
    (350, 'La paz de Dios guardará vuestros corazones y vuestros pensamientos.', 'Filipenses'),
    (351, 'Dios es nuestro refugio y fortaleza, nuestro pronto auxilio.', 'Salmos'),
    (352, 'El Señor es bueno con todos y su compasión abraza a toda la creación.', 'Salmos'),
    (353, 'Ama a tu prójimo como a ti mismo.', 'Jesús de Nazaret'),
    (354, 'La bendición del Señor enriquece y no añade tristeza.', 'Proverbios'),
    (355, 'En Dios está mi salvación y mi gloria.', 'Salmos'),
    (356, 'La palabra de Dios permanece para siempre.', 'Isaías'),
    (357, 'Sé fuerte en el Señor y en el poder de su fuerza.', 'Efesios'),
    (358, 'Dios es fiel y no permitirá que seáis tentados más de lo que podéis resistir.', '1 Corintios'),
    (359, 'El Señor está cerca de los que tienen el corazón quebrantado.', 'Salmos'),
    (360, 'Buscad al Señor mientras puede ser hallado.', 'Isaías'),
    (361, 'La misericordia del Señor llena la tierra.', 'Salmos'),
    (362, 'Crea en mí, oh Dios, un corazón limpio.', 'Salmos'),
    (363, 'El Señor alumbrará mis tinieblas.', '2 Samuel'),
    (364, 'Grandes cosas ha hecho el Señor con nosotros y estamos alegres.', 'Salmos'),
    (365, 'El Señor te bendiga y te guarde; el Señor haga resplandecer su rostro sobre ti.', 'Números')
ON CONFLICT (dia) DO UPDATE SET frase = EXCLUDED.frase, autor = EXCLUDED.autor;

NOTIFY pgrst, 'reload schema';
