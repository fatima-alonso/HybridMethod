/**
 * BORRADOR de la política de privacidad y de las condiciones de contratación (DECISIONS A22).
 *
 * Se usa mientras no haya una versión validada. Antes del lanzamiento (Fase 8):
 * - Completar los datos marcados como [Pendiente] (responsable, domicilio, correo de contacto).
 * - Pedir la revisión de un abogado.
 * Las reglas de negocio que se describen aquí salen del SRS v1.7 (RF-18, RF-19, RF-21, RF-22, RN-09,
 * RN-13): si cambian, actualizar también este texto.
 */

export type LegalSection = {
  heading: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
};

export type LegalDocument = {
  title: string;
  updatedAt: string;
  intro: string;
  sections: readonly LegalSection[];
};

const DRAFT_DATE = "24 de noviembre de 2026";

export const PRIVACY_POLICY: LegalDocument = {
  title: "Política de privacidad",
  updatedAt: DRAFT_DATE,
  intro:
    "En THE HYBRID METHOD (by Ferro Fits) cuidamos tus datos personales. Este aviso explica qué datos pedimos, para qué los usamos y cómo puedes ejercer tus derechos.",
  sections: [
    {
      heading: "Responsable",
      paragraphs: [
        "El responsable del tratamiento de tus datos es [Pendiente: nombre o razón social del responsable], con domicilio en [Pendiente: domicilio]. Para cualquier tema de privacidad, escríbenos a [Pendiente: correo de contacto].",
      ],
    },
    {
      heading: "Datos que pedimos",
      items: [
        "Nombre completo.",
        "Correo electrónico.",
        "Número de WhatsApp.",
        "El programa que contratas, la modalidad de pago y el historial de tus pagos y periodos de servicio.",
      ],
      paragraphs: [
        "No guardamos los datos de tu tarjeta: los procesa directamente Stripe. La información deportiva (objetivos, experiencia, lesiones, disponibilidad) la compartes con tu entrenador por WhatsApp después de contratar, y no se guarda en este sitio.",
      ],
    },
    {
      heading: "Para qué los usamos",
      items: [
        "Verificar tu correo y registrar tu contratación.",
        "Procesar tus pagos y, si te suscribes, tus renovaciones.",
        "Enviarte confirmaciones, avisos de pago y el inicio de cada mes de servicio.",
        "Contactarte por WhatsApp para preparar y entregar tu plan de entrenamiento.",
      ],
      paragraphs: ["No usamos tus datos para publicidad de terceros ni los vendemos."],
    },
    {
      heading: "Con quién los compartimos",
      paragraphs: [
        "Solo con los proveedores que necesitamos para prestar el servicio, que los tratan por nuestra cuenta: Stripe (pagos), Resend (envío de correos), Vercel (alojamiento del sitio) y Neon (base de datos). Algunos de ellos pueden almacenar los datos fuera de México.",
      ],
    },
    {
      heading: "Cuánto tiempo los guardamos",
      paragraphs: [
        "Mientras tengas una relación con nosotros y, después, el tiempo que exijan las obligaciones fiscales y legales aplicables.",
      ],
    },
    {
      heading: "Tus derechos",
      paragraphs: [
        "Puedes acceder a tus datos, rectificarlos, cancelarlos u oponerte a su uso (derechos ARCO), así como revocar tu consentimiento, escribiendo a [Pendiente: correo de contacto]. Te responderemos en los plazos que marca la ley.",
      ],
    },
    {
      heading: "Cambios a este aviso",
      paragraphs: [
        "Si este aviso cambia, publicaremos la nueva versión en esta página con su fecha de actualización.",
      ],
    },
  ],
};

export const TERMS: LegalDocument = {
  title: "Condiciones de contratación",
  updatedAt: DRAFT_DATE,
  intro:
    "Estas condiciones aplican a la contratación de los programas de THE HYBRID METHOD (by Ferro Fits) desde este sitio.",
  sections: [
    {
      heading: "El servicio",
      paragraphs: [
        "Cada programa es un servicio de entrenamiento personalizado por periodos de un mes. Tu entrenador te contacta por WhatsApp para conocer tus objetivos y te entrega tu plan de entrenamiento por ese medio.",
      ],
    },
    {
      heading: "Precios y formas de pago",
      items: [
        "Los precios publicados están en pesos mexicanos y son el total que pagas.",
        "Puedes pagar por transferencia bancaria, con un pago único con tarjeta o con una suscripción mensual con tarjeta.",
        "La suscripción mensual tiene un 10 % de descuento sobre el precio del programa.",
        "Si tienes un código de descuento, escríbelo en el formulario de pago con tarjeta (pago único o suscripción). No aplica a la transferencia. En la suscripción, el descuento se suma al 10 % y dura lo que indique el código; cuando termina, se cobra el precio normal y te avisamos por correo antes del siguiente cobro.",
        "No cobramos comisiones adicionales por pagar con tarjeta.",
      ],
    },
    {
      heading: "Tu mes de servicio",
      paragraphs: [
        "Tu mes de servicio empieza el día en que se confirma tu pago y termina el mismo día del mes siguiente. Tu siguiente pago corresponde al cumplirse ese mes. Si pagas por adelantado tu siguiente mes, este empieza cuando termina el actual.",
        "Tu entrenador te entrega el plan de entrenamiento por WhatsApp de 3 a 5 días hábiles después de que se confirma tu pago.",
        "Una transferencia se considera pagada cuando tu entrenador confirma que la recibió.",
      ],
    },
    {
      heading: "Suscripción mensual",
      items: [
        "Se cobra automáticamente cada mes, en la misma fecha del primer pago, hasta que la canceles.",
        "Si el cobro de una renovación falla, se intenta de nuevo una vez al día, hasta 3 días seguidos en total. Mientras haya un pago pendiente, el servicio se suspende. Si ninguno de los intentos se completa, la suscripción se cancela y termina tu programación.",
        'Puedes cancelarla, cambiar de programa o actualizar tu tarjeta desde "Administrar mi suscripción", después de verificar tu correo. La cancelación aplica al final del periodo pagado y no pierdes los días que ya pagaste. Un cambio de programa aplica en la siguiente renovación.',
      ],
    },
    {
      heading: "Contrataciones pendientes",
      paragraphs: [
        "Si inicias una contratación y no la pagas, queda pendiente con su referencia. Si no hay actividad en 7 días, vence y tendrás que iniciar una nueva.",
      ],
    },
    {
      heading: "Reembolsos",
      paragraphs: [
        "No hay reembolsos automáticos. Si tienes algún problema con tu pago o tu servicio, escríbele a tu entrenador por WhatsApp o a [Pendiente: correo de contacto] y lo revisaremos contigo. Estas condiciones no limitan los derechos que te reconoce la legislación de protección al consumidor.",
      ],
    },
    {
      heading: "Contacto",
      paragraphs: [
        "Para dudas sobre estas condiciones, escríbenos a [Pendiente: correo de contacto] o por WhatsApp.",
      ],
    },
  ],
};
