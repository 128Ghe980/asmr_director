type Registration = {
  references: number;
  onPlay: () => void;
  onInactive: () => void;
};

const registrations = new WeakMap<HTMLAudioElement, Registration>();
let activeAudio: HTMLAudioElement | null = null;

/**
 * Opt an audio element into page-local exclusive playback.
 * Registration never starts or stops media; an actual play event pauses the
 * previously playing registered element. The caller still owns source cleanup.
 */
export function registerAudioPlayback(audio: HTMLAudioElement): () => void {
  let registration = registrations.get(audio);
  if (!registration) {
    registration = {
      references: 0,
      onPlay: () => {
        const previous = activeAudio;
        activeAudio = audio;
        if (previous && previous !== audio) previous.pause();
      },
      onInactive: () => {
        if (activeAudio === audio) activeAudio = null;
      },
    };
    registrations.set(audio, registration);
    audio.addEventListener("play", registration.onPlay);
    audio.addEventListener("pause", registration.onInactive);
    audio.addEventListener("ended", registration.onInactive);
    audio.addEventListener("error", registration.onInactive);
  }
  registration.references += 1;
  const currentRegistration = registration;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    currentRegistration.references -= 1;
    if (currentRegistration.references > 0) return;
    audio.removeEventListener("play", currentRegistration.onPlay);
    audio.removeEventListener("pause", currentRegistration.onInactive);
    audio.removeEventListener("ended", currentRegistration.onInactive);
    audio.removeEventListener("error", currentRegistration.onInactive);
    registrations.delete(audio);
    if (activeAudio === audio) activeAudio = null;
  };
}
