# THE HYBRID METHOD
## Software Requirements Specification (SRS)

| | |
|---|---|
| **Versión** | 1.7 |
| **Estado** | Actualizado para desarrollo |
| **Producto** | THE HYBRID METHOD / by Ferro Fits |
| **Tipo de sistema** | Landing page informativa y plataforma básica de contratación y pagos |

### Historial de cambios
| Versión | Fecha | Cambios |
|---|---|---|
| 1.3 | — | Borrador actualizado para desarrollo. |
| 1.4 | 2026-11-23 | Se incorporan las decisiones de `docs/DECISIONS.md` (A1–A8): verificación de correo obligatoria antes de contratar, confirmación de transferencias con enlace + PIN, eliminación de la acción de rechazo, mismo precio para el pago único y la suscripción, y expiración de enlaces definida. |
| 1.5 | 2026-11-23 | RF-05: se define el formato permitido del número de WhatsApp (DECISIONS A11). |
| 1.6 | 2026-11-23 | RF-04/RF-05: WhatsApp de cualquier país con selector de lada (México por defecto), validado por país y guardado en E.164 (DECISIONS A15, reemplaza a A11). |
| 1.7 | 2026-11-24 | Respuestas de Ferro (DECISIONS A17–A22): precios finales y 10 % de descuento en suscripción (reemplaza RN-13); cobro mes con mes desde la fecha de pago y registro informativo de la fecha de entrega del plan, con recordatorios a Ferro (RF-22, RF-23); suspensión por pago fallido; cancelación y cambio de plan con el Stripe Customer Portal; un solo contrato pendiente por cliente, vencimiento a los 7 días y pago por adelantado del siguiente mes (RF-21); borrador de privacidad y condiciones. |

---

## 1. Introducción

### 1.1 Propósito
Este documento define los requisitos funcionales, los no funcionales y las reglas de negocio para el desarrollo de la landing page de THE HYBRID METHOD.

Su objetivo es establecer con claridad el comportamiento esperado del sistema antes de empezar la implementación.

### 1.2 Descripción general
THE HYBRID METHOD es un servicio de entrenamiento personalizado enfocado en fuerza, running y rendimiento híbrido, dirigido por Ferro Fits.

La landing page permitirá a los visitantes conocer la marca, consultar los programas disponibles, revisar sus precios y contratar un servicio mediante transferencia bancaria o pago en línea.

El sistema registrará clientes, contratos, pagos y suscripciones, y enviará notificaciones automáticas al cliente y al entrenador.

La comunicación posterior a la contratación y la entrega de los planes de entrenamiento se harán directamente por WhatsApp, fuera del sistema.

### 1.3 Objetivos del producto
- Presentar la marca y sus servicios de forma profesional.
- Convertir visitantes en clientes.
- Permitir la contratación de programas.
- Procesar pagos únicos y suscripciones recurrentes.
- Registrar clientes, contratos y transacciones.
- Automatizar confirmaciones y notificaciones por correo.
- Notificar al entrenador sobre nuevas contrataciones y renovaciones.
- Permitir contratar sin crear una cuenta.

---

## 2. Alcance del sistema

### 2.1 Funcionalidades incluidas
1. Landing page informativa.
2. Presentación del entrenador y su metodología.
3. Presentación de los programas de entrenamiento.
4. Visualización de precios.
5. Formulario básico de registro.
6. Verificación del correo electrónico mediante código OTP antes de contratar.
7. Selección del método de pago.
8. Integración con Stripe.
9. Registro de transferencias bancarias pendientes de confirmación.
10. Confirmación manual de transferencias por parte del entrenador (enlace privado + PIN).
11. Gestión de suscripciones y renovaciones automáticas.
12. Registro de clientes, contratos y pagos.
13. Notificaciones por correo electrónico.
14. Reconocimiento de clientes recurrentes mediante verificación de correo.
15. Cancelación de suscripciones y cambio de programa en el Stripe Customer Portal, con acceso por OTP.
17. Registro informativo de la fecha de entrega de cada plan por parte del entrenador, con recordatorios mientras esté pendiente.
16. Acceso directo a WhatsApp para contactar al entrenador.

### 2.2 Funcionalidades fuera del alcance
El sistema no incluirá:
- Plataforma de entrenamiento o dashboard para atletas.
- Cuentas tradicionales con contraseña.
- Seguimiento del rendimiento deportivo.
- Calendarios de entrenamiento.
- Cuestionarios deportivos durante la contratación.
- Aprobación manual de clientes.
- Generación o entrega de archivos PDF con rutinas.
- Automatización de la comunicación por WhatsApp.
- Administración de entrenadores.
- Gestión automatizada de reembolsos.
- Panel administrativo personalizado en la primera versión.

Ferro recopilará directamente por WhatsApp, después del pago, los cuestionarios deportivos, objetivos, experiencia, lesiones, disponibilidad y demás información necesaria para preparar el entrenamiento.

---

## 3. Usuarios del sistema

### 3.1 Visitante
Persona que entra a la landing page para conocer los servicios.

Puede:
- Consultar información.
- Revisar programas y precios.
- Consultar las preguntas frecuentes.
- Iniciar una contratación.

### 3.2 Cliente
Persona que completa el formulario, verifica su correo y contrata un programa.

Puede:
- Proporcionar sus datos.
- Verificar su correo electrónico con un código.
- Seleccionar un programa.
- Elegir un método de pago.
- Completar el pago.
- Recibir confirmaciones por correo.
- Contactar al entrenador por WhatsApp.
- Administrar su suscripción (cancelar, cambiar de programa, actualizar su tarjeta) en el Stripe Customer Portal.

### 3.3 Entrenador (Ferro)
Responsable de administrar las contrataciones y prestar el servicio.

Recibe notificaciones sobre:
- Nuevas contrataciones.
- Transferencias pendientes.
- Transferencias confirmadas.
- Pagos exitosos.
- Renovaciones exitosas.
- Pagos fallidos.
- Cancelaciones de suscripciones.
- Entregas de plan pendientes de registrar.

Registra en el sistema la fecha en que entrega cada plan con el botón del correo de compra (RF-23).

En el caso de las transferencias, verifica manualmente que recibió el dinero y confirma el pago con el enlace privado que recibe por correo y su PIN personal.

---

## 4. Descripción general del producto

### 4.1 Identidad visual
La interfaz deberá respetar la identidad visual de THE HYBRID METHOD.

| Elemento | Especificación |
|---|---|
| Negro | `#111111` |
| Off-white | `#F5F3EE` |
| Volt Orange | `#FF6A00` |
| Estilo | Premium, deportivo y editorial |
| Tipografía | Sans-serif, con encabezados fuertes y condensados |
| Fotografía | Imágenes reales de entrenamiento y deporte |

La distribución visual propuesta es 70% negro, 20% off-white y 10% naranja.

Se usarán el logotipo y el wordmark oficiales.

### 4.2 Estructura de la landing page
La página deberá incluir las siguientes secciones:
1. **Home / Hero:** presentación principal y llamada a la acción.
2. **About Me:** presentación de Ferro y su experiencia.
3. **Our Programs:** explicación de los programas disponibles.
4. **How It Works:** explicación del proceso de contratación y entrenamiento.
5. **Pricing:** precios y modalidades de contratación.
6. **Athlete Application / Registration:** formulario básico de contratación.
7. **FAQ & Contact:** preguntas frecuentes y medios de contacto.

La marca proporcionará o aprobará el contenido y las imágenes definitivas.

---

## 5. Programas y precios
El sistema deberá presentar tres programas:

| Programa | Descripción | Pago único / transferencia | Suscripción mensual (−10 %) |
|---|---|---|---|
| HM RUN | Running performance, resistencia, ritmos y eficiencia. | $1,200 MXN | $1,080 MXN |
| HM STRENGTH | Fuerza, hipertrofia y composición corporal. | $1,500 MXN | $1,350 MXN |
| HM COMPLETE | Fuerza, running, HYROX y rendimiento híbrido. | $1,800 MXN | $1,620 MXN |

Los programas están dirigidos a atletas principiantes, intermedios y avanzados.

**Descuento por suscripción:** la suscripción mensual tiene un 10 % de descuento en todos los programas. La transferencia y el pago único pagan el precio completo (DECISIONS A18).

**Precios finales:** los importes anteriores son el precio total que paga el cliente (DECISIONS A18). La página deberá mostrar los dos precios de cada programa. No se deberá cobrar una comisión adicional por pagar con tarjeta.

En Stripe, cada programa tiene un Price `one_time` con el precio completo y un Price `recurring` mensual con el precio de suscripción.

---

## 6. Requisitos funcionales

### RF-01. Visualización de la landing page
El sistema deberá mostrar información sobre THE HYBRID METHOD, el entrenador, los programas, los precios, la metodología y los medios de contacto.

### RF-02. Visualización de programas
El sistema deberá presentar los tres programas disponibles con su descripción y precio.

### RF-03. Selección de programa
El usuario deberá poder seleccionar un programa para iniciar su contratación.

Si el usuario llega al formulario desde la llamada a la acción de un programa, ese programa deberá aparecer preseleccionado.

### RF-04. Formulario de registro
El sistema deberá solicitar los siguientes datos:

| Campo | Obligatorio |
|---|---|
| Nombre completo | Sí |
| Correo electrónico | Sí |
| Número de WhatsApp / teléfono | Sí |
| Programa seleccionado | Sí |
| Aceptación de la política de privacidad | Sí |

No se pedirá información deportiva ni otros datos (por ejemplo, el país) durante este proceso. El selector de lada del WhatsApp solo sirve para leer el número y no se guarda como país del cliente (DECISIONS A15).

### RF-05. Validación del formulario
El sistema deberá:
- Validar los campos obligatorios.
- Validar el formato del correo electrónico.
- Validar que el número de contacto sea válido para el país elegido en el selector de lada (México por defecto; se acepta cualquier país). Se aceptan espacios, guiones, puntos y paréntesis como separadores, y el número se guarda en formato internacional E.164 (DECISIONS A15).
- Comprobar la aceptación de la política de privacidad.
- Evitar registros incompletos.

### RF-06. Selección del método de pago
Una vez verificado el correo (RF-15), el sistema deberá permitir seleccionar una de estas modalidades:
1. Transferencia bancaria.
2. Pago único mediante Stripe.
3. Suscripción mensual mediante Stripe.

### RF-07. Pago único mediante Stripe
El sistema deberá permitir que el cliente haga un pago único mediante Stripe Checkout.

Una vez confirmado el pago, deberá:
- Registrar la transacción.
- Registrar el contrato.
- Activar el periodo de servicio: un mes desde la fecha de pago (RF-22).
- Enviar un correo de confirmación al cliente.
- Enviar al entrenador el correo de compra con los datos del cliente y el botón para registrar la entrega del plan (RF-23).

### RF-08. Suscripción mensual mediante Stripe
El sistema deberá permitir contratar un programa mediante una suscripción mensual.

La suscripción deberá:
- Renovarse automáticamente cada mes.
- Cobrar mes con mes desde la fecha del primer pago, sin depender de la fecha de entrega del plan (RF-22).
- Registrar cada pago exitoso.
- Prestar el servicio solo mientras los pagos estén al corriente.
- Notificar al entrenador por correo cada vez que se complete una renovación.
- Enviar al cliente los correos de contratación y renovación.

La suscripción seguirá renovándose hasta que se cancele.

### RF-09. Transferencia bancaria
Cuando el cliente seleccione transferencia bancaria, el sistema deberá:
1. Registrar al cliente o asociar la contratación al cliente existente.
2. Crear un contrato en estado `pending_payment`.
3. Generar una referencia única de contratación.
4. Registrar el programa y el importe.
5. Enviar una notificación al correo del entrenador con el enlace privado de confirmación.
6. Mostrar una pantalla de transferencia pendiente.
7. Permitir que el cliente contacte al entrenador por WhatsApp.

La pantalla deberá mostrar la referencia de contratación y las instrucciones disponibles para hacer el pago.

El entrenador enviará los datos bancarios al cliente directamente por WhatsApp.

### RF-10. Contacto por WhatsApp desde la transferencia
La pantalla de transferencia pendiente deberá incluir un botón para abrir WhatsApp.

El mensaje deberá generarse con información del contexto, por ejemplo:

> Hola Ferro, acabo de solicitar mi inscripción a HM Run. Mi referencia es HM-2026-000001. Quería avisarte sobre mi transferencia.

Se usará el número oficial de WhatsApp del entrenador, pendiente de configurar.

### RF-11. Confirmación manual de transferencias
El entrenador recibirá por correo un enlace privado para revisar y confirmar una transferencia.

El enlace deberá abrir una pantalla de confirmación que muestre:
- Nombre del cliente.
- Correo electrónico.
- Programa contratado.
- Importe.
- Método de pago.
- Referencia del contrato.
- Estado actual del pago.

La pantalla deberá preguntar:

> ¿Confirmas que recibiste el pago?

e incluirá un campo para que el entrenador escriba su **PIN de aprobación**.

Se mostrarán dos opciones:
- **Sí, confirmar pago:** envía la confirmación junto con el PIN.
- **No, regresar:** cierra o regresa sin enviar nada al sistema.

Abrir el enlace no confirma el pago. La confirmación solo se ejecuta cuando el entrenador escribe un PIN válido y selecciona explícitamente "Sí, confirmar pago".

El contrato sigue en `pending_payment` mientras el entrenador no lo apruebe. No existe una acción de rechazo.

### RF-12. Activación después de la confirmación
Cuando el entrenador confirme una transferencia, el sistema deberá:
- Validar que el enlace sea válido, esté vigente y no se haya usado.
- Validar el PIN del entrenador.
- Verificar que el contrato siga pendiente de pago (`pending_payment`, o `expired` si venció sin pagarse: el pago se respeta, RF-21).
- Registrar el pago como exitoso.
- Registrar quién confirmó el pago y cuándo.
- Invalidar el enlace usado.
- Cambiar el contrato a `active` y activar el periodo de servicio: un mes desde la fecha de confirmación (RF-22).
- Enviar al cliente un correo de confirmación y bienvenida.
- Enviar al entrenador el correo de compra con el botón para registrar la entrega del plan (RF-23).

### RF-13. Notificaciones al entrenador
El sistema deberá enviar un correo al entrenador cuando ocurra alguno de estos eventos:
- Nueva contratación por transferencia (incluye el enlace privado de confirmación).
- Cada pago confirmado (pago único, transferencia, primer pago y renovaciones de la suscripción): correo de compra con los datos del cliente y el botón para registrar la entrega del plan (RF-23).
- Cada día hábil, mientras haya un plan sin fecha de entrega: un recordatorio por cliente (RF-23).
- Pago fallido.
- Cancelación de suscripción.
- Confirmación manual de una transferencia.

La dirección de correo definitiva ya está disponible y deberá agregarse a la configuración del sistema.

### RF-14. Notificaciones al cliente
El sistema deberá enviar:
- El código de verificación de correo.
- La confirmación de compra.
- El correo de bienvenida, con el aviso de que Ferro entregará el plan en 3 a 5 días hábiles.
- La confirmación de pago.
- La confirmación de cancelación de la suscripción.
- Avisos sobre renovaciones y pagos fallidos.

### RF-15. Verificación de correo y clientes recurrentes
Antes de crear cualquier contratación, el sistema deberá verificar el correo electrónico del cliente con un código OTP enviado a ese correo. **La verificación se hará siempre**, tanto si el correo ya está registrado como si no.

- La respuesta del sistema al pedir el código deberá ser la misma exista o no el correo, para que no se pueda averiguar qué correos están registrados.
- Si el correo corresponde a un cliente existente, después de verificarlo la nueva contratación se asociará a ese cliente y se actualizarán su nombre y WhatsApp si cambiaron.
- Si el correo no existe, se creará el cliente después de verificarlo.
- No se usará un sistema tradicional de usuario y contraseña.
- No se mostrará información privada sin una verificación previa.

### RF-16. Registro de clientes y contratos
El sistema deberá guardar los datos básicos de los clientes, sus programas, contratos, métodos de pago y el estado de sus suscripciones.

### RF-17. Renovaciones
El sistema deberá registrar cada renovación exitosa como un nuevo pago asociado a la suscripción correspondiente.

Cada renovación exitosa deberá generar una notificación al entrenador.

### RF-18. Pagos fallidos
El sistema deberá registrar los intentos de cobro fallidos y actualizar el estado de la suscripción.

Stripe reintenta el cobro con Smart Retries (configuración por defecto). Mientras haya un pago vencido, el servicio queda suspendido. Si un reintento se paga, el servicio se reanuda. Si se agotan los reintentos, la suscripción se cancela (DECISIONS A19).

### RF-19. Cancelación de suscripciones
El cliente podrá cancelar su suscripción en el Stripe Customer Portal, al que entra después de verificar su correo con un código (DECISIONS A21).

La cancelación se aplica al final del periodo: impide las renovaciones futuras sin quitar el servicio ya pagado. En el mismo portal, el cliente puede cambiar de programa (el cambio aplica en la siguiente renovación) y actualizar su tarjeta.

### RF-20. Enlaces privados de confirmación
Los enlaces para confirmar transferencias deberán:
- Ser únicos.
- Usar tokens seguros.
- Guardar únicamente el hash del token.
- Expirar a los 7 días (valor configurable).
- Ser de un solo uso.
- Invalidarse después de la confirmación.
- Invalidarse después de 5 intentos con un PIN incorrecto.

Si un enlace expira o se invalida, el contrato no se elimina ni se cancela: sigue en `pending_payment` y se puede generar un enlace nuevo.

El botón de entrega del plan (RF-23) tiene sus propias reglas: token seguro guardado solo como hash, vence a los 7 días, no pide PIN y deja de servir en cuanto se registra la entrega.

### RF-21. Contrataciones posteriores
Reglas para un cliente que vuelve a contratar (DECISIONS A20):
- **Un solo contrato pendiente por cliente.** Si ya tiene uno del mismo programa y modalidad, se reutiliza su referencia. Si es de otro programa o modalidad, la página le avisa que se encontró un registro pendiente y le pregunta si quiere continuar con él o cambiarlo. Si lo cambia, se actualiza el mismo contrato y conserva su referencia.
- **Vencimiento.** Un contrato pendiente vence tras 7 días sin actividad (configurable). Un contrato vencido ya no se reutiliza. Si aun así llega un pago real (una transferencia que Ferro confirma o un pago de Stripe que se confirma tarde), se respeta y el contrato se activa.
- **Pago por adelantado.** Con un contrato de pago único o transferencia vigente o por empezar, el cliente puede pagar su siguiente mes, del mismo programa o de otro. Ese mes empieza cuando termina el vigente. Se permite un solo mes por adelantado.
- **Con suscripción activa** no se puede crear otra contratación: el cambio de programa se hace en el portal (RF-19).

### RF-22. Periodos de servicio y fechas de pago
Cada pago confirmado da un mes de servicio que **empieza en la fecha de pago** y termina el mismo día del mes siguiente (o el último día de ese mes si el día no existe). Así aplica a todos los métodos: con la suscripción, el siguiente cobro llega al cumplirse un mes del pago anterior; con pago único o transferencia, el siguiente mes se paga cuando se cumple un mes del pago (DECISIONS A19).

Si el cliente pagó por adelantado con un periodo vigente (RF-21), el mes nuevo empieza cuando termina el vigente.

La fecha de entrega del plan no cambia el periodo ni los cobros.

### RF-23. Registro de la fecha de entrega del plan
El entrenador entrega el plan de 3 a 5 días hábiles después del pago. El sistema guardará la fecha de entrega **solo como dato de referencia** (DECISIONS A19).

- Después de cada pago confirmado, el entrenador recibe un correo de compra con todos los datos del cliente y de la compra, y un botón **"Registrar entrega del plan"**.
- El botón abre una pantalla con los datos de ese plan, un campo de fecha (hoy por defecto, se puede cambiar) y un botón para confirmar. La fecha no puede ser futura ni anterior al día del pago. Al confirmar, el sistema guarda la fecha y muestra **"Fecha de entrega del plan confirmada"**. No hace nada más.
- Se pide esa confirmación explícita porque algunos programas de correo abren los enlaces automáticamente. Si bastara con abrir el enlace, se registraría una fecha falsa en cuanto llega el correo.
- La fecha se registra una sola vez. Si se abre un botón de ese plan después, muestra la fecha ya registrada.
- Mientras no se registre la fecha, el sistema envía al entrenador **cada día hábil** (lunes a viernes) un recordatorio: "Está pendiente el plan de [cliente]", con su propio botón "Registrar entrega del plan". Los recordatorios se detienen en cuanto se registra la fecha con cualquiera de los botones.

---

## 7. Reglas de negocio

**RN-01. Contratación directa.** El cliente podrá seleccionar un programa y contratarlo directamente, después de verificar su correo. No existirá un proceso de aprobación de clientes.

**RN-02. Duración del servicio.** Cada mes pagado da un periodo de servicio de un mes calendario desde la fecha de pago (RF-22).

**RN-03. Renovación automática.** Las suscripciones se renovarán automáticamente cada mes hasta que el cliente las cancele.

**RN-04. Transferencias.** Una transferencia solo se considerará pagada después de que Ferro confirme que la recibió, usando el enlace privado y su PIN.

**RN-05. Activación del servicio.** El servicio solo podrá activarse después de confirmar un pago exitoso, ya sea por Stripe o por la confirmación manual de una transferencia.

**RN-06. Comunicación deportiva.** Ferro recopilará la información deportiva del cliente por WhatsApp después de la contratación.

**RN-07. Entrega del entrenamiento.** Ferro preparará y enviará los planes de entrenamiento directamente por WhatsApp, de 3 a 5 días hábiles después del pago, y registrará en el sistema la fecha de entrega como dato de referencia (RF-23).

**RN-08. Cambios de programa.** Los cambios de programa respetan el periodo ya pagado: con pago único o transferencia, el siguiente mes se paga por adelantado con el nuevo programa; con suscripción, el cambio se hace en el portal y aplica en la siguiente renovación (RF-21).

**RN-09. Reembolsos.** La primera versión no incluye un módulo automatizado de reembolsos. Si Ferro autoriza un reembolso, se gestionará manualmente y se cancelará la suscripción recurrente cuando corresponda. La política definitiva deberá cumplir con la normativa aplicable y no deberá interpretarse como una renuncia a los derechos legales del consumidor.

**RN-10. Seguridad de pagos.** El sistema no guardará números completos de tarjeta ni códigos CVV. El procesamiento de tarjetas es responsabilidad de Stripe.

**RN-11. Prevención de duplicados.** Los eventos de Stripe deberán procesarse de forma idempotente para no duplicar pagos, contratos, activaciones ni notificaciones.

**RN-12. Verificación previa.** No se creará ningún contrato sin una verificación vigente del correo del cliente.

**RN-13. Descuento por suscripción.** La suscripción mensual cuesta un 10 % menos que el precio del programa. La transferencia y el pago único pagan el precio completo. El servidor toma siempre los dos importes de la BD (DECISIONS A18).

**RN-14. Suspensión por falta de pago.** Mientras una suscripción tenga un pago vencido, el servicio se suspende (RF-18).

**RN-15. Contratos pendientes.** Un cliente tiene como máximo un contrato pendiente de pago, que vence tras 7 días sin actividad (RF-21).

---

## 8. Requisitos no funcionales

### RNF-01. Seguridad
- Todas las comunicaciones deberán usar HTTPS.
- Las claves API deberán guardarse como variables de entorno.
- Los enlaces privados deberán usar tokens seguros.
- Los códigos OTP y el PIN del entrenador deberán guardarse solo como hash y tener un límite de intentos.
- Los endpoints sensibles deberán validar permisos y estados.
- Los webhooks de Stripe deberán verificar su firma.
- Los datos personales deberán protegerse contra accesos no autorizados.

### RNF-02. Rendimiento
La landing page deberá estar optimizada para cargar rápido y funcionar con fluidez en celulares y computadoras.

### RNF-03. Disponibilidad
El sistema deberá usar servicios de hosting administrados que mantengan la aplicación disponible y gestionen los errores de infraestructura.

### RNF-04. Compatibilidad
La interfaz deberá funcionar en las versiones actuales de los navegadores principales y adaptarse a distintos tamaños de pantalla.

### RNF-05. Usabilidad
El proceso de contratación deberá ser sencillo y claro, y requerir la menor cantidad de pasos posible. La verificación de correo deberá hacerse en un solo paso, con un código corto y la opción de reenviarlo.

### RNF-06. Mantenibilidad
El código deberá estar organizado por módulos y responsabilidades, con separación entre presentación, lógica de negocio, acceso a datos e integraciones externas.

### RNF-07. Integridad de datos
El sistema deberá mantener relaciones consistentes entre clientes, contratos, pagos y suscripciones.

### RNF-08. Privacidad
El sistema deberá pedir solo la información necesaria para completar la contratación y deberá tener una política de privacidad y condiciones de contratación accesibles. No deberá revelar si un correo está registrado.

---

## 9. Flujos principales

### 9.1 Flujo de pago único
1. El visitante consulta los programas.
2. Selecciona un programa.
3. Completa el formulario.
4. El sistema envía un código de verificación a su correo.
5. El cliente escribe el código y el sistema lo verifica.
6. El cliente selecciona pago único.
7. El sistema crea o asocia al cliente.
8. El sistema crea el contrato en `pending_payment`.
9. El cliente completa el pago en Stripe Checkout.
10. Stripe notifica el resultado al backend mediante un webhook.
11. El sistema verifica el evento y registra el pago.
12. El sistema cambia el contrato a `active`: un mes desde la fecha de pago.
13. Se envía el correo de bienvenida al cliente.
14. El entrenador recibe el correo de compra con el botón para registrar la entrega del plan.
15. Cuando entrega el plan, registra la fecha con ese botón. Mientras no lo haga, recibe un recordatorio cada día hábil.

### 9.2 Flujo de suscripción mensual
1. El visitante selecciona un programa.
2. Completa el formulario.
3. Verifica su correo con el código recibido.
4. Selecciona suscripción mensual.
5. El sistema crea o asocia al cliente y crea el contrato.
6. Se crea la sesión de Stripe Checkout en modo suscripción.
7. El cliente completa el pago.
8. Stripe notifica el resultado mediante un webhook.
9. El sistema registra la suscripción y el primer pago.
10. Se activa el servicio: un mes desde la fecha de pago.
11. El cliente recibe la confirmación y la bienvenida.
12. El entrenador recibe el correo de compra con el botón para registrar la entrega del plan.
13. Al cumplirse un mes del pago, Stripe hace la renovación automática.
14. Cada renovación exitosa se registra y el entrenador recibe otro correo de compra con su botón de entrega.
15. Si un cobro falla, el servicio se suspende hasta que se pague.

### 9.3 Flujo de transferencia bancaria
1. El visitante selecciona un programa.
2. Completa el formulario.
3. Verifica su correo con el código recibido.
4. Selecciona transferencia bancaria.
5. El sistema crea o asocia al cliente y crea el contrato en `pending_payment`.
6. Se genera una referencia única.
7. Se envía al entrenador un correo con el enlace privado de confirmación.
8. El cliente ve la pantalla de transferencia pendiente.
9. El cliente contacta a Ferro por WhatsApp.
10. Ferro le da los datos bancarios.
11. El cliente hace la transferencia y puede enviar su comprobante por WhatsApp.
12. Ferro verifica el movimiento en su banco.
13. Ferro abre el enlace privado.
14. El sistema muestra la pantalla de confirmación.
15. Ferro escribe su PIN y selecciona "Sí, confirmar pago". Si selecciona "No, regresar", no pasa nada y el contrato sigue pendiente.
16. El sistema registra el pago, activa el servicio (un mes desde la confirmación) y envía los correos correspondientes, incluido el correo de compra a Ferro con el botón de entrega del plan.

### 9.4 Flujo de cancelación
1. El cliente entra a "Administrar mi suscripción".
2. Verifica su correo con un código.
3. El sistema identifica su suscripción y abre el Stripe Customer Portal.
4. El cliente cancela en el portal.
5. Stripe detiene las renovaciones al final del periodo vigente.
6. El sistema actualiza el estado mediante webhooks.
7. El cliente recibe una confirmación.
8. El entrenador recibe una notificación.

---

## 10. Datos que manejará el sistema
El sistema deberá guardar información de:
- Clientes.
- Programas.
- Contratos.
- Pagos.
- Periodos de servicio (fecha de pago, inicio y fin de cada mes, y fecha de entrega del plan como referencia).
- Suscripciones.
- Confirmaciones manuales de transferencia.
- Verificaciones de correo electrónico.
- Eventos de webhook.
- Registros de auditoría de operaciones sensibles.

La estructura técnica y las relaciones se especifican en el SDD.

---

## 11. Integraciones externas

| Servicio | Función |
|---|---|
| Stripe Checkout | Procesamiento de pagos únicos y suscripciones |
| Stripe Billing | Renovaciones y administración de suscripciones |
| Stripe Webhooks | Notificación de eventos de pago |
| Resend | Envío de correos electrónicos |
| PostgreSQL | Persistencia de datos |
| Neon | Proveedor de PostgreSQL |
| Vercel | Hosting de la aplicación |
| GoDaddy | Proveedor del dominio |
| WhatsApp | Comunicación directa entre cliente y entrenador |

La comunicación por WhatsApp será mediante enlaces de contacto. El MVP no incluye integración con la API de WhatsApp.

---

## 12. Criterios de aceptación generales
La primera versión se considerará funcional cuando:
1. La landing page muestre correctamente la información de la marca.
2. Se puedan consultar los tres programas.
3. El formulario valide y registre los datos.
4. No se pueda contratar sin verificar el correo, y la verificación no revele si un correo ya existe.
5. Se pueda iniciar un pago único con Stripe.
6. Se pueda iniciar una suscripción mensual con Stripe.
7. Las suscripciones se renueven automáticamente.
8. Los webhooks registren correctamente los pagos.
9. Las transferencias se puedan registrar como pendientes.
10. Ferro pueda confirmar transferencias con el enlace privado, su PIN y una acción explícita.
11. Los clientes reciban los correos de confirmación y bienvenida.
12. Ferro pueda registrar la fecha de entrega de cada plan y reciba recordatorios mientras esté pendiente.
13. Ferro reciba notificaciones de nuevas contrataciones y renovaciones exitosas.
14. Los datos se guarden correctamente.
15. La interfaz funcione en celulares y computadoras.
16. No haga falta crear una cuenta tradicional para contratar.

---

## 13. Decisiones de implementación

### 13.1 Stack tecnológico

| Componente | Tecnología |
|---|---|
| Framework | Next.js |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS |
| Base de datos | PostgreSQL |
| ORM | Prisma |
| Proveedor de PostgreSQL | Neon |
| Pagos | Stripe Checkout y Billing |
| Correos | Resend |
| Hosting | Vercel |

### 13.2 Estado de las decisiones pendientes

| # | Decisión | Estado |
|---|---|---|
| 1 | Proveedor de PostgreSQL | **Definido:** Neon. |
| 2 | Productos, precios e impuestos | **Definido:** precios finales; suscripción con 10 % de descuento; un Price `one_time` y uno `recurring` por programa. Faltan los Price IDs de producción. |
| 3 | Correo de notificaciones de Ferro | **Definido.** Se carga en las variables de entorno. |
| 4 | Dominio definitivo | **Definido:** GoDaddy. Pendiente de compra y configuración (Fase 8). |
| 5 | Remitente de Resend | **Definido.** Se verifica con el dominio (Fase 8). |
| 6 | Fechas de los periodos de servicio | **Definido:** un mes desde la fecha de pago en todos los métodos; la entrega del plan es solo referencia (RF-22, RF-23). |
| 7 | Reintentos y suspensión por pagos fallidos | **Definido:** Smart Retries; servicio suspendido mientras haya un pago vencido (RF-18). |
| 8 | Mecanismo de cancelación | **Definido:** Stripe Customer Portal con OTP, al final del periodo (RF-19). |
| 9 | Nuevas contrataciones con un periodo vigente | **Definido** en RF-21. |
| 10 | Número de WhatsApp oficial de Ferro | **Definido.** Se carga en las variables de entorno. |
| 11 | Expiración y regeneración de enlaces privados | **Definido:** 7 días (configurable), un solo uso, se invalidan tras 5 PIN incorrectos y se pueden regenerar si el contrato sigue pendiente. |
| 12 | Política de privacidad y condiciones de contratación | Hay un borrador publicado. Faltan los datos del responsable y la revisión legal. |

### 13.3 Otras decisiones y consideraciones
- **Renovación automática:** confirmada. Las suscripciones se renuevan cada mes hasta que se cancelan.
- **Verificación de correo:** obligatoria antes de cualquier contratación, sea el correo nuevo o ya registrado.
- **Confirmación de transferencias:** con el enlace privado enviado al correo de Ferro más su PIN personal. No existe la acción de rechazo; el contrato sigue pendiente hasta que se apruebe.
- **Precio final:** los precios publicados son el total que paga el cliente (DECISIONS A18).
- **Reembolsos:** el MVP no tendrá un flujo automatizado. Los reembolsos que Ferro autorice se gestionarán manualmente y se registrarán internamente.
- **Cuentas de servicios externos:** crear las cuentas necesarias no bloquea el proyecto.

---

## 14. Glosario

| Término | Definición |
|---|---|
| Landing page | Página web informativa y de conversión. |
| Cliente | Persona que contrata un programa. |
| Programa | Servicio de entrenamiento que ofrece THE HYBRID METHOD. |
| Contrato | Registro de una contratación específica. |
| Suscripción | Contratación recurrente con renovación automática. |
| Pago único | Transacción que se hace una sola vez. |
| Transferencia pendiente | Pago que espera la confirmación manual. |
| Entrega del plan | Día en que Ferro entrega el plan de entrenamiento. Se guarda como referencia. |
| Periodo de servicio | Un mes pagado, desde la fecha de pago hasta el mismo día del mes siguiente. |
| Webhook | Notificación que un servicio externo envía a nuestro backend. |
| OTP | Código temporal para verificar la identidad mediante el correo electrónico. |
| PIN de aprobación | Código secreto que solo conoce Ferro y que se necesita para confirmar transferencias. |
| ORM | Herramienta para interactuar con la base de datos mediante código. |
| Idempotencia | Propiedad que evita procesar dos veces la misma operación. |

---

*Fin del documento — SRS v1.7*
