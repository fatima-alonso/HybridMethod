/**
 * Página temporal de la Fase 0: solo comprueba el tema de marca.
 * La landing completa (SRS §4.2) se construye en la Fase 1.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col justify-center px-6 py-24 sm:px-12">
      <p className="text-sm font-semibold tracking-[0.3em] text-volt uppercase">by Ferro Fits</p>
      <h1 className="mt-4 text-6xl sm:text-8xl">
        The Hybrid
        <br />
        Method
      </h1>
      <p className="mt-6 max-w-xl text-lg text-bone/80">
        Entrenamiento personalizado de fuerza, running y rendimiento híbrido.
      </p>
      <p className="mt-10 inline-flex w-fit bg-volt px-5 py-3 font-display text-xl font-bold tracking-wide text-ink uppercase">
        Muy pronto
      </p>
    </main>
  );
}
