/**
 * Textos de la landing (SRS §4.2).
 *
 * ⚠️ PLACEHOLDER: todo lo marcado con `placeholder: true` o con el comentario PLACEHOLDER es texto
 * de relleno que la marca debe reemplazar o aprobar antes del lanzamiento (SRS §4.2: "La marca
 * proporcionará o aprobará el contenido y las imágenes definitivas"). Las imágenes se muestran como
 * bloques "IMAGEN PENDIENTE" (componente `ImagePlaceholder`).
 *
 * Los textos que describen el proceso (How It Works, métodos de pago, FAQ operativas) vienen del
 * SRS y no son de relleno. Los nombres de sección van en inglés (SRS §4.2); el resto, en español.
 */

export const SECTION_IDS = {
  home: "home",
  about: "about",
  programs: "programs",
  howItWorks: "how-it-works",
  pricing: "pricing",
  application: "athlete-application",
  faq: "faq",
} as const;

export const NAV_LINKS = [
  { href: `/#${SECTION_IDS.about}`, label: "About Me" },
  { href: `/#${SECTION_IDS.programs}`, label: "Our Programs" },
  { href: `/#${SECTION_IDS.howItWorks}`, label: "How It Works" },
  { href: `/#${SECTION_IDS.pricing}`, label: "Pricing" },
  { href: `/#${SECTION_IDS.faq}`, label: "FAQ & Contact" },
] as const;

export const HERO = {
  eyebrow: "by Ferro Fits",
  // Titular y subtítulo en inglés por decisión de la marca (DECISIONS A13).
  title: ["Run.", "Lift.", "Hybrid."],
  lead: "Individualized training built for your goals. Strength, running and hybrid performance under one method.",
  primaryCta: "Elige tu programa",
  secondaryCta: "Cómo funciona",
  imageLabel: "Foto principal: atleta entrenando fuerza y running",
};

/**
 * About Me: texto de Ferro (2026-11-25). El kicker y los indicadores de autoridad van en inglés por
 * decisión de la marca (DECISIONS A24), como el hero (A13).
 */
export const ABOUT = {
  title: "About Me",
  kicker: "Experience beyond the trend.",
  paragraphs: [
    "Soy Ferro, dueño de Bunker Studio, gimnasio boutique de Functional Bodybuilding, y Momentum Wellness, especializado en HYROX y Barre. Cuento con más de 15 años de experiencia en la industria del fitness y la programación de entrenamiento.",
    "El entrenamiento híbrido no es nuevo; HYROX y el running simplemente han impulsado su popularidad.",
    "The Hybrid Method integra fuerza, resistencia y rendimiento deportivo mediante programaciones personalizadas, fundamentadas en la ciencia del ejercicio y la periodización.",
  ],
  closing: "Una metodología que nace de la experiencia, no de una tendencia.",
  signature: { name: "Ferro", role: "Founder & Head Coach" },
  /** Indicadores de autoridad, debajo de la fotografía. */
  stats: [
    {
      value: "15+",
      label: "Years of Experience",
      detail: "Experiencia en la industria del fitness.",
    },
    {
      value: "2",
      label: "Training Studios",
      detail: "Founder of Bunker · Partner at Momentum.",
    },
    {
      value: "100%",
      label: "Individualized Approach",
      detail: "Programación adaptada a cada atleta.",
    },
    {
      value: "360°",
      label: "Athletic Development",
      detail: "Strength · Endurance · Performance.",
    },
  ],
  imageLabel: "Retrato de Ferro",
};

export const PROGRAMS_SECTION = {
  title: "Our Programs",
  lead: "Tres programas, un mismo método. Para atletas principiantes, intermedios y avanzados.",
  cta: "Quiero este programa",
};

/** Proceso según SRS §9 y RN-06/RN-07. */
export const HOW_IT_WORKS = {
  title: "How It Works",
  lead: "Contratar es rápido y no necesitas crear una cuenta.",
  steps: [
    {
      title: "Elige tu programa",
      body: "HM RUN, HM STRENGTH o HM COMPLETE, según tu objetivo.",
    },
    {
      title: "Regístrate y verifica tu correo",
      body: "Déjanos tu nombre, correo y WhatsApp. Te enviamos un código para confirmar tu correo.",
    },
    {
      title: "Paga como prefieras",
      body: "Transferencia bancaria, pago único con tarjeta o suscripción mensual.",
    },
    {
      title: "Ferro te contacta por WhatsApp",
      body: "Conoce tus objetivos, experiencia, lesiones y disponibilidad para personalizar tu plan.",
    },
    {
      title: "Recibe tu plan y entrena",
      body: "Tu entrenamiento llega por WhatsApp y se ajusta a tu progreso.",
    },
  ],
};

/** Modalidades de pago (RF-06) y reglas de precio (SRS §5, RN-13). */
export const PRICING = {
  title: "Pricing",
  lead: "Precio mensual. Con la suscripción mensual pagas 10 % menos.",
  perMonth: "/ mes",
  /** Precio con suscripción, debajo del precio completo (DECISIONS A18). */
  withSubscription: (price: string) => `${price} con suscripción`,
  methods: [
    {
      name: "Transferencia bancaria",
      body: "Ferro confirma tu pago manualmente y activa tu servicio.",
    },
    { name: "Pago único", body: "Pagas un mes con tarjeta, sin renovación automática." },
    {
      name: "Suscripción mensual",
      body: "10 % de descuento. Se cobra automáticamente cada mes hasta que la canceles.",
    },
  ],
  notes: [
    "Precios en pesos mexicanos (MXN).",
    // Precios finales de Ferro: lo que paga el cliente, sin cargos aparte (DECISIONS A18).
    "Precios finales: no hay cargos adicionales.",
    "Sin comisión adicional por pagar con tarjeta.",
  ],
  cta: "Contratar",
};

export const APPLICATION = {
  title: "Athlete Application",
  lead: "Completa tus datos para empezar. Solo te pediremos lo necesario: tus objetivos y experiencia los platicas con Ferro por WhatsApp después de contratar.",
  submit: "Continuar",
  submitting: "Enviando código…",
};

/** FAQ: respuestas basadas en el SRS. PLACEHOLDER: la marca puede ajustar redacción y añadir más. */
export const FAQ = {
  title: "FAQ & Contact",
  items: [
    {
      question: "¿Necesito crear una cuenta?",
      answer:
        "No. Solo completas el formulario y verificas tu correo con un código que te enviamos.",
    },
    {
      question: "¿Para qué nivel son los programas?",
      answer: "Para atletas principiantes, intermedios y avanzados. Tu plan se adapta a tu nivel.",
    },
    {
      question: "¿Cómo recibo mi entrenamiento?",
      answer:
        "Después de tu pago, Ferro te contacta por WhatsApp para conocer tus objetivos, experiencia, lesiones y disponibilidad, y te envía tu plan por ahí.",
    },
    {
      question: "¿Qué métodos de pago aceptan?",
      answer:
        "Transferencia bancaria, pago único con tarjeta y suscripción mensual con tarjeta. La transferencia y el pago único cuestan el precio completo; la suscripción mensual tiene 10 % de descuento.",
    },
    {
      question: "¿Cuándo empieza mi servicio?",
      answer:
        "Cuando se confirma tu pago. Con tarjeta es inmediato; con transferencia, en cuanto Ferro confirma que la recibió.",
    },
    {
      question: "¿La suscripción se renueva sola?",
      answer:
        "Sí, se cobra cada mes hasta que la canceles. Al cancelar, conservas el periodo que ya pagaste.",
    },
  ],
  contactTitle: "¿Tienes otra duda?",
  contactBody: "Escríbele directo a Ferro por WhatsApp.",
  contactCta: "Escribir por WhatsApp",
  contactUnavailable: "WhatsApp de contacto pendiente de configurar.",
  whatsappMessage: "Hola Ferro, vi THE HYBRID METHOD y tengo una duda.",
};

export const FOOTER = {
  tagline: "Entrenamiento personalizado de fuerza, running y rendimiento híbrido.",
  /** Primero "Administrar mi suscripción" (DECISIONS A33), luego los documentos legales. */
  legal: [
    { href: "/suscripcion", label: "Administrar mi suscripción" },
    { href: "/privacidad", label: "Política de privacidad" },
    { href: "/condiciones", label: "Condiciones de contratación" },
  ],
};

/** Enlace al formulario con el programa preseleccionado (RF-03). */
export function applicationHref(programSlug?: string): string {
  const query = programSlug ? `?programa=${encodeURIComponent(programSlug)}` : "";
  return `/${query}#${SECTION_IDS.application}`;
}

/** Nombre del parámetro de URL que preselecciona el programa en el formulario. */
export const PROGRAM_QUERY_PARAM = "programa";
