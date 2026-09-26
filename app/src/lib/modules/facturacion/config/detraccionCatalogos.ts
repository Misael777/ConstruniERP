/**
 * Catálogos SUNAT de la "Información de la detracción" de la Factura (a pedido explícito del usuario, que
 * entregó las 3 listas): Tipo de operación, Bien o Servicio sujeto a detracción (con su % de detracción)
 * y Medio de pago. Datos fijos de referencia — no viven en la base de datos.
 */

export interface DetraccionTipoOperacion {
	codigo: string;
	nombre: string;
}

export interface DetraccionBienServicio {
	codigo: string;
	nombre: string;
	/** % de detracción que SUNAT fija para este bien/servicio. */
	porcentaje: number;
}

export interface DetraccionMedioPago {
	codigo: string;
	nombre: string;
}

export const DETRACCION_TIPOS_OPERACION: DetraccionTipoOperacion[] = [
	{ codigo: '1001', nombre: 'Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central.' },
	{ codigo: '1002', nombre: 'Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central o Recursos Hidrobiológicos.' },
	{ codigo: '1003', nombre: 'Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central o Servicio de Transporte de Pasajeros.' },
	{ codigo: '1004', nombre: 'Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central o Servicio de Transporte de Carga.' }
];

export const DETRACCION_BIENES_SERVICIOS: DetraccionBienServicio[] = [
	{ codigo: '001', nombre: 'Azúcar y melaza de caña', porcentaje: 10 },
	{ codigo: '003', nombre: 'Alcohol etílico', porcentaje: 10 },
	{ codigo: '004', nombre: 'Recursos hidrobiológicos', porcentaje: 4 },
	{ codigo: '005', nombre: 'Maíz amarillo duro', porcentaje: 4 },
	{ codigo: '007', nombre: 'Caña de azúcar', porcentaje: 10 },
	{ codigo: '008', nombre: 'Madera', porcentaje: 4 },
	{ codigo: '009', nombre: 'Oro y demás minerales metálicos cedidos en opción de compra', porcentaje: 10 },
	{ codigo: '010', nombre: 'Desperdicios y desechos metálicos / chatarra', porcentaje: 4 },
	{ codigo: '011', nombre: 'Minerales no metálicos', porcentaje: 10 },
	{ codigo: '012', nombre: 'Joyas y objetos de orfebrería', porcentaje: 10 },
	{ codigo: '014', nombre: 'Carnes y despojos comestibles', porcentaje: 4 },
	{ codigo: '017', nombre: 'Harina, torta y de residuos de pescado / subproductos', porcentaje: 4 },
	{ codigo: '019', nombre: 'Arrendamiento de bienes muebles o inmuebles', porcentaje: 10 },
	{ codigo: '020', nombre: 'Contratos de construcción', porcentaje: 4 },
	{ codigo: '021', nombre: 'Servicio de transporte de bienes por vía terrestre', porcentaje: 4 },
	{ codigo: '022', nombre: 'Mantenimiento y reparación de bienes muebles', porcentaje: 12 },
	{ codigo: '023', nombre: 'Leche', porcentaje: 4 },
	{ codigo: '024', nombre: 'Comisión mercantil', porcentaje: 10 },
	{ codigo: '025', nombre: 'Fabricación de bienes por encargo', porcentaje: 10 },
	{ codigo: '026', nombre: 'Servicio de transporte de personas', porcentaje: 10 },
	{ codigo: '030', nombre: 'Contratos de gerencia', porcentaje: 10 },
	{ codigo: '034', nombre: 'Minerales metálicos no auríferos', porcentaje: 10 },
	{ codigo: '035', nombre: 'Bienes exonerados del IGV', porcentaje: 1.5 },
	{ codigo: '036', nombre: 'Oro y demás minerales metálicos exonerados del IGV', porcentaje: 1.5 },
	{ codigo: '037', nombre: 'Demás servicios gravados con el IGV', porcentaje: 12 },
	{ codigo: '039', nombre: 'Minerales oligoelementos', porcentaje: 10 },
	{ codigo: '040', nombre: 'Bienes del inciso J del Apéndice I de la Ley del IGV', porcentaje: 4 },
	{ codigo: '041', nombre: 'Plomo', porcentaje: 10 }
];

/** Catálogo "Código de Bien/Servicio sujeto a detracción" (lista entregada por el usuario) — distinto de
 * DETRACCION_BIENES_SERVICIOS (que trae el % para proponer en el formulario): esta lista solo identifica el
 * código con el que se declara la operación. */
export const DETRACCION_CODIGOS_BIEN_SERVICIO: DetraccionMedioPago[] = [
	{ codigo: '001', nombre: 'Azúcar y melaza de caña' },
	{ codigo: '002', nombre: 'Arroz' },
	{ codigo: '003', nombre: 'Alcohol etílico' },
	{ codigo: '004', nombre: 'Recursos hidrobiológicos' },
	{ codigo: '005', nombre: 'Maíz amarillo duro' },
	{ codigo: '006', nombre: 'Algodón' },
	{ codigo: '007', nombre: 'Caña de azúcar' },
	{ codigo: '008', nombre: 'Madera' },
	{ codigo: '009', nombre: 'Arena y piedra' },
	{ codigo: '010', nombre: 'Residuos, subproductos, desechos, recortes y desperdicios' },
	{ codigo: '011', nombre: 'Bienes gravados con el IGV, con renuncia a la exoneración del IGV' },
	{ codigo: '012', nombre: 'Intermediación laboral y tercerización' },
	{ codigo: '013', nombre: 'Animales vivos' },
	{ codigo: '014', nombre: 'Carnes y despojos comestibles' },
	{ codigo: '015', nombre: 'Abonos, cueros y pieles de origen animal' },
	{ codigo: '016', nombre: 'Aceite de pescado' },
	{ codigo: '017', nombre: 'Harina, polvo y “pellets” de pescado, crustáceos, moluscos y demás invertebrados acuáticos' },
	{ codigo: '018', nombre: 'Embarcaciones pesqueras' },
	{ codigo: '019', nombre: 'Arrendamiento de bienes muebles e inmuebles' },
	{ codigo: '020', nombre: 'Mantenimiento y reparación de bienes muebles' },
	{ codigo: '021', nombre: 'Movimiento de carga' },
	{ codigo: '022', nombre: 'Otros servicios empresariales' },
	{ codigo: '023', nombre: 'Leche cruda entera' },
	{ codigo: '024', nombre: 'Comisión mercantil' },
	{ codigo: '025', nombre: 'Fabricación de bienes por encargo' },
	{ codigo: '026', nombre: 'Servicio de transporte de personas' },
	{ codigo: '027', nombre: 'Servicio de transporte de carga' },
	{ codigo: '028', nombre: 'Transporte de pasajeros' },
	{ codigo: '029', nombre: 'Algodón en rama sin desmontar' },
	{ codigo: '030', nombre: 'Contratos de construcción' },
	{ codigo: '031', nombre: 'Oro gravado con el IGV' },
	{ codigo: '032', nombre: 'Páprika y otros frutos de los géneros capsicum o pimienta' },
	{ codigo: '033', nombre: 'Espárragos' },
	{ codigo: '034', nombre: 'Minerales metálicos no auríferos' },
	{ codigo: '035', nombre: 'Bienes exonerados del IGV' },
	{ codigo: '036', nombre: 'Oro y demás minerales metálicos exonerados del IGV' },
	{ codigo: '037', nombre: 'Demás servicios gravados con el IGV' },
	{ codigo: '039', nombre: 'Minerales no metálicos' },
	{ codigo: '040', nombre: 'Bien inmueble gravado con IGV' },
	{ codigo: '041', nombre: 'Plomo' },
	{ codigo: '044', nombre: 'Servicio de beneficio de minerales metálicos gravado con el IGV' },
	{ codigo: '045', nombre: 'Minerales de oro y sus concentrados gravados con el IGV' }
];

export const DETRACCION_MEDIOS_PAGO: DetraccionMedioPago[] = [
	{ codigo: '001', nombre: 'Depósito en cuenta' },
	{ codigo: '002', nombre: 'Giro' },
	{ codigo: '003', nombre: 'Transferencia de fondos' },
	{ codigo: '004', nombre: 'Orden de pago' },
	{ codigo: '005', nombre: 'Tarjeta de débito' },
	{ codigo: '006', nombre: 'Tarjeta de crédito emitida en el país por una empresa del sistema financiero' },
	{ codigo: '007', nombre: 'Cheques con la cláusula de NO NEGOCIABLE, INTRANSFERIBLES, NO A LA ORDEN u otra equivalente, a que se refiere el inciso g) del artículo 5° de la ley' },
	{ codigo: '008', nombre: 'Efectivo, por operaciones en las que no existe obligación de utilizar medio de pago' },
	{ codigo: '009', nombre: 'Efectivo, en los demás casos' },
	{ codigo: '010', nombre: 'Medios de pago usados en comercio exterior' },
	{ codigo: '011', nombre: 'Documentos emitidos por las EDPYMES y las cooperativas de ahorro y crédito no autorizadas a captar depósitos del público' },
	{ codigo: '012', nombre: 'Tarjeta de crédito emitida en el país o en el exterior por una empresa no perteneciente al sistema financiero, cuyo objeto principal sea la emisión y administración de tarjetas de crédito' },
	{ codigo: '013', nombre: 'Tarjetas de crédito emitidas en el exterior por empresas bancarias o financieras no domiciliadas' },
	{ codigo: '101', nombre: 'Transferencias - Comercio exterior' },
	{ codigo: '102', nombre: 'Cheques bancarios - Comercio exterior' },
	{ codigo: '103', nombre: 'Orden de pago simple - Comercio exterior' },
	{ codigo: '104', nombre: 'Orden de pago documentario - Comercio exterior' },
	{ codigo: '105', nombre: 'Remesa simple - Comercio exterior' },
	{ codigo: '106', nombre: 'Remesa documentaria - Comercio exterior' },
	{ codigo: '107', nombre: 'Carta de crédito simple - Comercio exterior' },
	{ codigo: '108', nombre: 'Carta de crédito documentario - Comercio exterior' },
	{ codigo: '999', nombre: 'Otros medios de pago' }
];

export function buscarBienServicioPorNombre(nombre: string): DetraccionBienServicio | undefined {
	return DETRACCION_BIENES_SERVICIOS.find((b) => b.nombre === nombre);
}
