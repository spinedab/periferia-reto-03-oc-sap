// Auto-generado desde fixtures/reto-03/ para modo demostrativo 24/7 sin caídas
export const FIXTURES_DATA = {
  "maestros": {
    "proveedores": [
      {
        "codigo_sap": "100234",
        "nit": "900555111",
        "nombre": "TecnoSuministros S.A.S.",
        "condiciones_pago_default": "Z030",
        "indicador_iva_default": "C1",
        "activo": true
      },
      {
        "codigo_sap": "100310",
        "nit": "901222333",
        "nombre": "Cloud Andina S.A.S.",
        "condiciones_pago_default": "Z000",
        "indicador_iva_default": "C1",
        "activo": true
      },
      {
        "codigo_sap": "100118",
        "nit": "800444555",
        "nombre": "Papelería Central Ltda.",
        "condiciones_pago_default": "Z015",
        "indicador_iva_default": "C1",
        "activo": true
      },
      {
        "codigo_sap": "100150",
        "nit": "830111222",
        "nombre": "Mobiliario Andino S.A.",
        "condiciones_pago_default": "Z030",
        "indicador_iva_default": "C1",
        "activo": true
      },
      {
        "codigo_sap": "100402",
        "nit": "901777888",
        "nombre": "Consultores Ágiles S.A.S.",
        "condiciones_pago_default": "Z030",
        "indicador_iva_default": "C1",
        "activo": false
      }
    ],
    "centrosCosto": [
      {
        "centro_costo": "CC-1010",
        "nombre": "Tecnología",
        "subareas": [
          "Infraestructura",
          "Soporte",
          "Desarrollo"
        ],
        "aprobadores": [
          {
            "email": "mlopez@periferia-ficticia.com",
            "nombre": "Mariana López Cárdenas",
            "tope": 50000000
          },
          {
            "email": "dgarcia@periferia-ficticia.com",
            "nombre": "Diego García Rincón",
            "tope": 200000000
          }
        ]
      },
      {
        "centro_costo": "CC-2020",
        "nombre": "Administración",
        "subareas": [
          "Compras",
          "Servicios Generales"
        ],
        "aprobadores": [
          {
            "email": "rtorres@periferia-ficticia.com",
            "nombre": "Rocío Torres Ibáñez",
            "tope": 30000000
          }
        ]
      },
      {
        "centro_costo": "CC-3030",
        "nombre": "Comercial",
        "subareas": [
          "Preventa",
          "Marketing"
        ],
        "aprobadores": [
          {
            "email": "fvargas@periferia-ficticia.com",
            "nombre": "Felipe Vargas Ocampo",
            "tope": 80000000
          }
        ]
      }
    ],
    "indicadoresIva": [
      {
        "codigo": "C0",
        "descripcion": "Excluido / no gravado",
        "tasa": 0
      },
      {
        "codigo": "C1",
        "descripcion": "IVA 19%",
        "tasa": 0.19
      },
      {
        "codigo": "C2",
        "descripcion": "IVA 5%",
        "tasa": 0.05
      }
    ],
    "condicionesPago": [
      {
        "codigo": "Z000",
        "descripcion": "Pago inmediato",
        "dias": 0
      },
      {
        "codigo": "Z015",
        "descripcion": "15 días fecha factura",
        "dias": 15
      },
      {
        "codigo": "Z030",
        "descripcion": "30 días fecha factura",
        "dias": 30
      },
      {
        "codigo": "Z060",
        "descripcion": "60 días fecha factura",
        "dias": 60
      }
    ]
  },
  "solicitudes": {
    "sol-001": {
      "correo": {
        "id": "sol-001-correo",
        "de": "juan.camargo@periferia-ficticia.com",
        "para": "compras@periferia-ficticia.com",
        "asunto": "Solicitud de orden de compra SOL-001 - Renovación licencias antivirus corporati",
        "fecha": "2026-08-20T09:00:00-05:00",
        "cuerpo": "Hola Camila,\n\nAdjunto la solicitud de compra, la cotización del proveedor y el correo de aprobación de mi líder. Quedo atento a la orden de compra.\n\nGracias,\nJuan Camargo",
        "adjuntos": [
          "solicitud.xlsx",
          "cotizacion.pdf",
          "aprobacion.eml"
        ],
        "nota_fixture": "Los adjuntos binarios se entregan normalizados: solicitud.xlsx → solicitud.json, cotizacion.pdf → cotizacion.txt, aprobacion.eml → aprobacion.json, factura.pdf → factura.txt"
      },
      "solicitud": {
        "solicitud_id": "SOL-2026-001",
        "solicitante": "Juan Camargo",
        "proveedor_nombre": "TecnoSuministros S.A.S.",
        "proveedor_nit": "900555111",
        "descripcion": "Renovación licencias antivirus corporativo 120 puestos, vigencia 12 meses",
        "centro_costo": "CC-1010",
        "subarea": "Infraestructura",
        "cantidad": 120,
        "valor_unitario": 95000,
        "valor_total": 11400000,
        "moneda": "COP",
        "indicador_iva": "C1",
        "condiciones_pago": "Z030",
        "fecha_solicitud": "2026-08-20"
      },
      "cotizacionTxt": "COTIZACIÓN COT-TS-2026-0451\nFecha: 2026-08-18\nProveedor: TecnoSuministros S.A.S.\nNIT: 900.555.111-2\nCliente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nÍTEMS\n1. Licencia antivirus corporativo 12 meses | Cantidad: 120 | Precio unitario (IVA incl.): COP 95.000 | Subtotal: COP 11.400.000\n\nBase gravable: COP 9.579.832\nIVA 19%: COP 1.820.168\nTOTAL (IVA incluido): COP 11.400.000\n\nValidez de la oferta: 30 días\nCondiciones de pago: según acuerdo comercial vigente.\n",
      "aprobacion": {
        "de": "mlopez@periferia-ficticia.com",
        "para": "juan.camargo@periferia-ficticia.com",
        "cc": [
          "compras@periferia-ficticia.com"
        ],
        "fecha": "2026-08-21T10:02:00-05:00",
        "asunto": "RE: Solicitud de orden de compra SOL-001",
        "cuerpo": "Aprobado, proceder con la orden de compra.\n\nMariana López\nGerente de Tecnología"
      },
      "facturaTxt": null
    },
    "sol-002": {
      "correo": {
        "id": "sol-002-correo",
        "de": "sofía.herrera@periferia-ficticia.com",
        "para": "compras@periferia-ficticia.com",
        "asunto": "Solicitud de orden de compra SOL-002 - Licencia anual herramienta de pruebas au",
        "fecha": "2026-08-22T09:00:00-05:00",
        "cuerpo": "Hola Camila,\n\nAdjunto la solicitud de compra, la cotización del proveedor y el correo de aprobación de mi líder. Quedo atento a la orden de compra.\n\nGracias,\nSofía Herrera",
        "adjuntos": [
          "solicitud.xlsx",
          "cotizacion.pdf",
          "aprobacion.eml"
        ],
        "nota_fixture": "Los adjuntos binarios se entregan normalizados: solicitud.xlsx → solicitud.json, cotizacion.pdf → cotizacion.txt, aprobacion.eml → aprobacion.json, factura.pdf → factura.txt"
      },
      "solicitud": {
        "solicitud_id": "SOL-2026-002",
        "solicitante": "Sofía Herrera",
        "proveedor_nombre": "Soluciones Digitales del Norte S.A.S.",
        "proveedor_nit": "901999000",
        "descripcion": "Licencia anual herramienta de pruebas automatizadas, 5 usuarios",
        "centro_costo": "CC-1010",
        "subarea": "Desarrollo",
        "cantidad": 5,
        "valor_unitario": 1700000,
        "valor_total": 8500000,
        "moneda": "COP",
        "indicador_iva": "C1",
        "condiciones_pago": "Z030",
        "fecha_solicitud": "2026-08-22"
      },
      "cotizacionTxt": "COTIZACIÓN SDN-0093\nFecha: 2026-08-21\nProveedor: Soluciones Digitales del Norte S.A.S.\nNIT: 901.999.000-5\nCliente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nÍTEMS\n1. Licencia anual pruebas automatizadas, por usuario | Cantidad: 5 | Precio unitario (IVA incl.): COP 1.700.000 | Subtotal: COP 8.500.000\n\nBase gravable: COP 7.142.857\nIVA 19%: COP 1.357.143\nTOTAL (IVA incluido): COP 8.500.000\n\nValidez de la oferta: 15 días\nCondiciones de pago: según acuerdo comercial vigente.\n",
      "aprobacion": {
        "de": "mlopez@periferia-ficticia.com",
        "para": "sofía.herrera@periferia-ficticia.com",
        "cc": [
          "compras@periferia-ficticia.com"
        ],
        "fecha": "2026-08-22T15:30:00-05:00",
        "asunto": "RE: Solicitud de orden de compra SOL-002",
        "cuerpo": "Aprobado.\n\nMariana López"
      },
      "facturaTxt": null
    },
    "sol-003": {
      "correo": {
        "id": "sol-003-correo",
        "de": "pedro.ayala@periferia-ficticia.com",
        "para": "compras@periferia-ficticia.com",
        "asunto": "Solicitud de orden de compra SOL-003 - Mobiliario para nueva sede: 40 puestos d",
        "fecha": "2026-08-24T09:00:00-05:00",
        "cuerpo": "Hola Camila,\n\nAdjunto la solicitud de compra, la cotización del proveedor y el correo de aprobación de mi líder. Quedo atento a la orden de compra.\n\nGracias,\nPedro Ayala",
        "adjuntos": [
          "solicitud.xlsx",
          "cotizacion.pdf",
          "aprobacion.eml"
        ],
        "nota_fixture": "Los adjuntos binarios se entregan normalizados: solicitud.xlsx → solicitud.json, cotizacion.pdf → cotizacion.txt, aprobacion.eml → aprobacion.json, factura.pdf → factura.txt"
      },
      "solicitud": {
        "solicitud_id": "SOL-2026-003",
        "solicitante": "Pedro Ayala",
        "proveedor_nombre": "Mobiliario Andino S.A.",
        "proveedor_nit": "830111222",
        "descripcion": "Mobiliario para nueva sede: 40 puestos de trabajo con silla ergonómica",
        "centro_costo": "CC-2020",
        "subarea": "Servicios Generales",
        "cantidad": 40,
        "valor_unitario": 1850000,
        "valor_total": 74000000,
        "moneda": "COP",
        "indicador_iva": "C1",
        "condiciones_pago": "Z030",
        "fecha_solicitud": "2026-08-24"
      },
      "cotizacionTxt": "COTIZACIÓN MA-2026-1177\nFecha: 2026-08-20\nProveedor: Mobiliario Andino S.A.\nNIT: 830.111.222-8\nCliente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nÍTEMS\n1. Puesto de trabajo 1.40 m con silla ergonómica | Cantidad: 40 | Precio unitario (IVA incl.): COP 1.850.000 | Subtotal: COP 74.000.000\n\nBase gravable: COP 62.184.874\nIVA 19%: COP 11.815.126\nTOTAL (IVA incluido): COP 74.000.000\n\nValidez de la oferta: 45 días\nCondiciones de pago: según acuerdo comercial vigente.\n",
      "aprobacion": {
        "de": "fvargas@periferia-ficticia.com",
        "para": "pedro.ayala@periferia-ficticia.com",
        "cc": [
          "compras@periferia-ficticia.com"
        ],
        "fecha": "2026-08-25T09:10:00-05:00",
        "asunto": "RE: Solicitud de orden de compra SOL-003",
        "cuerpo": "Aprobado desde comercial, es para el equipo de preventa que se muda a la nueva sede.\n\nFelipe Vargas"
      },
      "facturaTxt": null
    },
    "sol-004": {
      "correo": {
        "id": "sol-004-correo",
        "de": "natalia.ríos@periferia-ficticia.com",
        "para": "compras@periferia-ficticia.com",
        "asunto": "Solicitud de orden de compra SOL-004 - Bolsa de 100 horas de arquitectura de nu",
        "fecha": "2026-08-26T09:00:00-05:00",
        "cuerpo": "Hola Camila,\n\nAdjunto la solicitud de compra, la cotización del proveedor y el correo de aprobación de mi líder. Quedo atento a la orden de compra.\n\nGracias,\nNatalia Ríos",
        "adjuntos": [
          "solicitud.xlsx",
          "cotizacion.pdf",
          "aprobacion.eml"
        ],
        "nota_fixture": "Los adjuntos binarios se entregan normalizados: solicitud.xlsx → solicitud.json, cotizacion.pdf → cotizacion.txt, aprobacion.eml → aprobacion.json, factura.pdf → factura.txt"
      },
      "solicitud": {
        "solicitud_id": "SOL-2026-004",
        "solicitante": "Natalia Ríos",
        "proveedor_nombre": "Cloud Andina S.A.S.",
        "proveedor_nit": "901222333",
        "descripcion": "Bolsa de 100 horas de arquitectura de nube para migración",
        "centro_costo": "CC-1010",
        "subarea": "Desarrollo",
        "cantidad": 100,
        "valor_unitario": 250000,
        "valor_total": 25000000,
        "moneda": "COP",
        "indicador_iva": "C1",
        "condiciones_pago": "Z000",
        "fecha_solicitud": "2026-08-26"
      },
      "cotizacionTxt": "COTIZACIÓN CA-2026-0310\nFecha: 2026-08-25\nProveedor: Cloud Andina S.A.S.\nNIT: 901.222.333-1\nCliente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nÍTEMS\n1. Hora de arquitecto de nube senior | Cantidad: 100 | Precio unitario (IVA incl.): COP 265.000 | Subtotal: COP 26.500.000\n\nBase gravable: COP 22.268.908\nIVA 19%: COP 4.231.092\nTOTAL (IVA incluido): COP 26.500.000\n\nValidez de la oferta: 20 días\nCondiciones de pago: según acuerdo comercial vigente.\n",
      "aprobacion": {
        "de": "dgarcia@periferia-ficticia.com",
        "para": "natalia.ríos@periferia-ficticia.com",
        "cc": [
          "compras@periferia-ficticia.com"
        ],
        "fecha": "2026-08-26T18:45:00-05:00",
        "asunto": "RE: Solicitud de orden de compra SOL-004",
        "cuerpo": "Aprobado por 25 millones según la solicitud.\n\nDiego García\nDirector de Tecnología"
      },
      "facturaTxt": null
    },
    "sol-005": {
      "correo": {
        "id": "sol-005-correo",
        "de": "camila.ortiz@periferia-ficticia.com",
        "para": "compras@periferia-ficticia.com",
        "asunto": "Solicitud de orden de compra SOL-005 - Papelería y tóner para el trimestre",
        "fecha": "2026-08-27T09:00:00-05:00",
        "cuerpo": "Hola Camila,\n\nAdjunto la solicitud de compra, la cotización del proveedor y el correo de aprobación de mi líder. Quedo atento a la orden de compra.\n\nGracias,\nCamila Ortiz",
        "adjuntos": [
          "solicitud.xlsx",
          "cotizacion.pdf",
          "aprobacion.eml",
          "factura.pdf"
        ],
        "nota_fixture": "Los adjuntos binarios se entregan normalizados: solicitud.xlsx → solicitud.json, cotizacion.pdf → cotizacion.txt, aprobacion.eml → aprobacion.json, factura.pdf → factura.txt"
      },
      "solicitud": {
        "solicitud_id": "SOL-2026-005",
        "solicitante": "Camila Ortiz",
        "proveedor_nombre": "Papelería Central Ltda.",
        "proveedor_nit": "800444555",
        "descripcion": "Papelería y tóner para el trimestre",
        "centro_costo": "CC-2020",
        "subarea": "Compras",
        "cantidad": 1,
        "valor_unitario": 3200000,
        "valor_total": 3200000,
        "moneda": "COP",
        "indicador_iva": "C1",
        "condiciones_pago": "Z015",
        "fecha_solicitud": "2026-08-27"
      },
      "cotizacionTxt": "COTIZACIÓN PC-5520\nFecha: 2026-08-05\nProveedor: Papelería Central Ltda.\nNIT: 800.444.555-3\nCliente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nÍTEMS\n1. Paquete trimestral papelería y tóner | Cantidad: 1 | Precio unitario (IVA incl.): COP 3.200.000 | Subtotal: COP 3.200.000\n\nBase gravable: COP 2.689.076\nIVA 19%: COP 510.924\nTOTAL (IVA incluido): COP 3.200.000\n\nValidez de la oferta: 30 días\nCondiciones de pago: según acuerdo comercial vigente.\n",
      "aprobacion": {
        "de": "rtorres@periferia-ficticia.com",
        "para": "camila.ortiz@periferia-ficticia.com",
        "cc": [
          "compras@periferia-ficticia.com"
        ],
        "fecha": "2026-08-28T08:20:00-05:00",
        "asunto": "RE: Solicitud de orden de compra SOL-005",
        "cuerpo": "Aprobado. Ya llegó la factura, por favor crear la OC para poder radicarla.\n\nRocío Torres"
      },
      "facturaTxt": "FACTURA ELECTRÓNICA DE VENTA No. FC-88231\nFecha de emisión: 2026-08-10\nVendedor: Papelería Central Ltda. - NIT 800.444.555-3\nAdquiriente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nDescripción: Paquete trimestral papelería y tóner\nBase gravable: COP 2.689.076\nIVA 19%: COP 510.924\nTOTAL: COP 3.200.000\n\nForma de pago: crédito 15 días.\n"
    },
    "sol-006": {
      "correo": {
        "id": "sol-006-correo",
        "de": "andrés.beltrán@periferia-ficticia.com",
        "para": "compras@periferia-ficticia.com",
        "asunto": "Solicitud de orden de compra SOL-006 - Diademas con micrófono para la mesa de s",
        "fecha": "2026-08-29T09:00:00-05:00",
        "cuerpo": "Hola Camila,\n\nAdjunto la solicitud de compra, la cotización del proveedor y el correo de aprobación de mi líder. Quedo atento a la orden de compra.\n\nGracias,\nAndrés Beltrán",
        "adjuntos": [
          "solicitud.xlsx",
          "cotizacion.pdf",
          "aprobacion.eml"
        ],
        "nota_fixture": "Los adjuntos binarios se entregan normalizados: solicitud.xlsx → solicitud.json, cotizacion.pdf → cotizacion.txt, aprobacion.eml → aprobacion.json, factura.pdf → factura.txt"
      },
      "solicitud": {
        "solicitud_id": "SOL-2026-006",
        "solicitante": "Andrés Beltrán",
        "proveedor_nombre": "TecnoSuministros S.A.S.",
        "descripcion": "Diademas con micrófono para la mesa de soporte",
        "centro_costo": "CC-1010",
        "subarea": "Soporte",
        "cantidad": 30,
        "valor_unitario": 180000,
        "valor_total": 5400000,
        "moneda": "COP",
        "fecha_solicitud": "2026-08-29"
      },
      "cotizacionTxt": "COTIZACIÓN COT-TS-2026-0468\nFecha: 2026-08-28\nProveedor: TecnoSuministros S.A.S.\nNIT: 900.555.111-2\nCliente: Periferia IT Group S.A.S. - NIT 900.123.456-7\n\nÍTEMS\n1. Diadema USB con micrófono y cancelación de ruido | Cantidad: 30 | Precio unitario (IVA incl.): COP 180.000 | Subtotal: COP 5.400.000\n\nBase gravable: COP 4.537.815\nIVA 19%: COP 862.185\nTOTAL (IVA incluido): COP 5.400.000\n\nValidez de la oferta: 30 días\nCondiciones de pago: según acuerdo comercial vigente.\n",
      "aprobacion": {
        "de": "mlopez@periferia-ficticia.com",
        "para": "andrés.beltrán@periferia-ficticia.com",
        "cc": [
          "compras@periferia-ficticia.com"
        ],
        "fecha": "2026-08-29T12:00:00-05:00",
        "asunto": "RE: Solicitud de orden de compra SOL-006",
        "cuerpo": "Aprobado.\n\nMariana López"
      },
      "facturaTxt": null
    }
  }
};
