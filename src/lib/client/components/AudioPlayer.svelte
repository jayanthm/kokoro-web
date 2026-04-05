<script lang="ts">
  import { AlertCircle, Download, Pause, Play, RotateCcw, RotateCw } from "lucide-svelte";

  interface Props {
    audioUrl: string;
    showSpectrogram: boolean;
    streamStatus?: "idle" | "streaming" | "finalized";
  }

  let { audioUrl, showSpectrogram: _showSpectrogram, streamStatus = "idle" }: Props = $props();
  void _showSpectrogram;

  let audioElement: HTMLAudioElement | null = $state(null);
  let isPlaying = $state(false);
  let isReady = $state(false);
  let isStartingPlayback = $state(false);
  let playbackError = $state("");
  let totalDurationSeconds = $state(0);
  let currentTimeSeconds = $state(0);
  let lastAudioUrl = $state("");
  let autoPlayAttemptedForUrl = $state("");

  const canSeek = $derived(Boolean(audioElement && audioElement.seekable.length > 0));
  const canPlay = $derived(Boolean(audioUrl && !isStartingPlayback));

  $effect(() => {
    if (audioUrl === lastAudioUrl) return;

    lastAudioUrl = audioUrl;
    isPlaying = false;
    isReady = false;
    isStartingPlayback = false;
    playbackError = "";
    totalDurationSeconds = 0;
    currentTimeSeconds = 0;

    if (!audioUrl) {
      autoPlayAttemptedForUrl = "";
    }
  });

  const syncStateFromAudio = () => {
    if (!audioElement) return;

    currentTimeSeconds = audioElement.currentTime || 0;
    totalDurationSeconds = Number.isFinite(audioElement.duration) ? audioElement.duration : 0;
    isPlaying = !audioElement.paused && !audioElement.ended;
  };

  const syncAndClearError = () => {
    playbackError = "";
    syncStateFromAudio();
  };

  const onCanPlay = () => {
    isReady = true;
    syncAndClearError();

    if (streamStatus === "streaming" && audioUrl && autoPlayAttemptedForUrl !== audioUrl) {
      autoPlayAttemptedForUrl = audioUrl;
      void tryPlay(true);
    }
  };

  const onLoadedMetadata = () => {
    isReady = true;
    syncStateFromAudio();
  };

  const onEnded = () => {
    isPlaying = false;
    syncStateFromAudio();
  };

  const onAudioError = () => {
    if (streamStatus === "streaming") {
      syncStateFromAudio();
      return;
    }

    playbackError = "Unable to play this audio stream. Try replaying or generating again.";
    isPlaying = false;
    isStartingPlayback = false;
  };

  function secondsToMinutes(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  async function tryPlay(silent = false) {
    if (!audioElement || !audioUrl) return;

    isStartingPlayback = true;
    try {
      await audioElement.play();
      playbackError = "";
    } catch (error) {
      if (!silent) {
        playbackError = (error as Error).message || "Playback was blocked by the browser.";
      }
    } finally {
      isStartingPlayback = false;
      syncStateFromAudio();
    }
  }

  async function playOrPause() {
    if (!audioElement || !audioUrl) return;

    if (isPlaying) {
      audioElement.pause();
      return;
    }

    await tryPlay();
  }

  function seekBy(secondsDelta: number) {
    if (!audioElement || !canSeek) return;

    const duration = Number.isFinite(audioElement.duration) ? audioElement.duration : Infinity;
    const nextTime = Math.max(0, Math.min(audioElement.currentTime + secondsDelta, duration));
    audioElement.currentTime = nextTime;
    syncStateFromAudio();
  }
</script>

<div class="rounded-box border-base-content/20 bg-base-100 border p-3">
  <div class="flex flex-wrap items-center gap-2">
    <button class="btn btn-circle btn-ghost" onclick={() => seekBy(-10)} disabled={!audioUrl || !canSeek}>
      <RotateCcw class="size-5" />
    </button>

    <button class="btn btn-circle btn-primary" onclick={playOrPause} disabled={!canPlay}>
      {#if isPlaying}
        <Pause class="size-6" />
      {:else}
        <Play class="size-6" />
      {/if}
    </button>

    <button class="btn btn-circle btn-ghost" onclick={() => seekBy(10)} disabled={!audioUrl || !canSeek}>
      <RotateCw class="size-5" />
    </button>

    <span class="text-sm tabular-nums">
      {secondsToMinutes(currentTimeSeconds)} / {secondsToMinutes(totalDurationSeconds)}
    </span>

    {#if streamStatus === "streaming"}
      <span class="badge badge-info badge-soft">Live</span>
    {/if}

    <a
      href={audioUrl}
      download
      class="btn btn-circle btn-ghost ml-auto"
      class:btn-disabled={streamStatus !== "finalized" || !audioUrl}
      aria-disabled={streamStatus !== "finalized" || !audioUrl}
    >
      <Download class="size-5" />
    </a>
  </div>

  <audio
    bind:this={audioElement}
    class="mt-3 w-full"
    src={audioUrl}
    controls
    preload="metadata"
    oncanplay={onCanPlay}
    onloadedmetadata={onLoadedMetadata}
    ontimeupdate={syncStateFromAudio}
    onplay={syncAndClearError}
    onpause={syncStateFromAudio}
    onended={onEnded}
    onerror={onAudioError}
  ></audio>

  {#if playbackError}
    <p class="text-error mt-2 flex items-center gap-2 text-xs">
      <AlertCircle class="size-3.5" />
      {playbackError}
    </p>
  {/if}
</div>
