-- Comentarios por cuota de cobro (pedido del cliente, 19/11/2026): en el Cronograma de Cobranza cada fracción lleva,
-- además de su condicionante (cobros.referencia), comentarios con fecha y su historial.
-- Se guardan en la propia fila de la cuota (jsonb) porque al editar el cronograma las cuotas 'programado' se borran y
-- se vuelven a crear (sincronizarCuotasProgramadas): el formulario conserva el arreglo y lo reinserta con la cuota.
-- Cada elemento: { "fecha": "AAAA-MM-DD", "texto": "...", "usuario": "...", "creado": "<ISO>" }. Idempotente.
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS comentarios jsonb NOT NULL DEFAULT '[]'::jsonb;
