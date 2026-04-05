<script lang="ts">
  import WaveSurfer from "wavesurfer.js";
  import Spectrogram from "wavesurfer.js/dist/plugins/spectrogram.esm.js";
  import Hover from "wavesurfer.js/dist/plugins/hover.esm.js";
  import { Download, Pause, Play, RotateCcw, RotateCw } from "lucide-svelte";
  import { fade } from "svelte/transition";

  interface Props {
    audioUrl: string;
    showSpectrogram: boolean;
    streamStatus?: "idle" | "streaming" | "finalized";
  }
  let { audioUrl, showSpectrogram, streamStatus = "idle" }: Props = $props();

  let waveSurfer: WaveSurfer | null = $state(null);
  let waveformContainer: HTMLDivElement | null = $state(null);
  let spectrogramContainer: HTMLDivElement | null = $state(null);
  let isPlaying = $state(false);
  let totalDuration = $state("0:00");
  let currentTime = $state("0:00");
  let isReady = $state(false);
  let totalDurationSeconds = $state(0);
  let currentTimeSeconds = $state(0);

  // Re-render when the audio URL changes, but not when the last URL is the same
  let lastAudioUrl = $state("");
  $effect(() => {
    if (audioUrl && audioUrl !== lastAudioUrl) {
      createWaveSurfer();
      lastAudioUrl = audioUrl;
    }
  });

  function createWaveSurfer() {
    // Reset the state
    isPlaying = false;
    totalDuration = "0:00";
    currentTime = "0:00";
    totalDurationSeconds = 0;
    currentTimeSeconds = 0;
    isReady = false;

    // Destroy the previous instance and reset elements
    if (waveSurfer !== null) {
      waveSurfer.destroy();
      waveSurfer = null;
      if (waveformContainer) waveformContainer.innerHTML = "";
      if (spectrogramContainer) spectrogramContainer.innerHTML = "";
    }

    // Check if all required elements are available
    if (!audioUrl) return;
    if (!waveformContainer) return;
    if (showSpectrogram && !spectrogramContainer) return;

    // Create a new instance
    waveSurfer = WaveSurfer.create({
      height: 40,
      normalize: true,
      cursorWidth: 3,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      container: waveformContainer,
      waveColor: "#c2c2c2",
      progressColor: window
        .getComputedStyle(document.body)
        .getPropertyValue("--color-primary"),
      url: audioUrl,
    });

    waveSurfer.registerPlugin(
      Hover.create({
        lineColor: "#ff0000",
        lineWidth: 2,
        labelBackground: "#555",
        labelColor: "#fff",
        labelSize: "11px",
      }),
    );

    if (showSpectrogram && spectrogramContainer) {
      waveSurfer.registerPlugin(
        Spectrogram.create({
          labels: true,
          height: 200,
          splitChannels: true,
          scale: "logarithmic",
          frequencyMax: 8000,
          frequencyMin: 0,
          fftSamples: 1024,
          labelsBackground: "rgba(0, 0, 0, 0.1)",
          container: spectrogramContainer,
        }),
      );
    }

    waveSurfer.on("play", () => {
      isPlaying = true;
    });

    waveSurfer.on("pause", () => {
      isPlaying = false;
    });

    waveSurfer.on("ready", (newTotalDuration) => {
      isReady = true;
      totalDurationSeconds = newTotalDuration;
      totalDuration = secondsToMinutes(newTotalDuration);
      if (streamStatus === "streaming") {
        waveSurfer?.play();
      }
    });

    waveSurfer.on("timeupdate", (newCurrentTime) => {
      currentTimeSeconds = newCurrentTime;
      currentTime = secondsToMinutes(newCurrentTime);
    });
  }

  function secondsToMinutes(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  function playOrPause() {
    if (!waveSurfer) return;
    if (!isReady) return;

    if (isPlaying) {
      waveSurfer.pause();
    } else {
      waveSurfer.play();
    }
  }

  function seekBy(secondsDelta: number) {
    if (!waveSurfer || !isReady) return;
    const nextTime = Math.max(
      0,
      Math.min(waveSurfer.getCurrentTime() + secondsDelta, waveSurfer.getDuration()),
    );
    waveSurfer.setTime(nextTime);
  }

  function seekByPercent(event: Event) {
    if (!waveSurfer || !isReady) return;
    const target = event.currentTarget as HTMLInputElement;
    const nextPercent = Number(target.value);
    if (!Number.isFinite(nextPercent)) return;
    waveSurfer.seekTo(nextPercent / 100);
  }
</script>

<div
  class="bg-base-100 border-base-content/20 rounded-box overflow-hidden border"
>
  <div class="p-2">
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <div class="flex items-center justify-start gap-2">
          <button
            class="btn btn-ghost btn-circle"
            onclick={() => seekBy(-10)}
            disabled={!isReady}
          >
            <span class="tooltip tooltip-right" data-tip="Back 10s">
              <RotateCcw class="size-5" />
            </span>
          </button>
          <button
            class="btn btn-ghost btn-circle"
            onclick={playOrPause}
            disabled={!isReady}
          >
          {#if isPlaying}
            <span in:fade class="tooltip tooltip-right" data-tip="Pause">
              <Pause class="size-6" />
            </span>
          {:else}
            <span in:fade class="tooltip tooltip-right" data-tip="Play">
              <Play class="size-6" />
            </span>
          {/if}
          </button>
          <button
            class="btn btn-ghost btn-circle"
            onclick={() => seekBy(10)}
            disabled={!isReady}
          >
            <span class="tooltip tooltip-right" data-tip="Forward 10s">
              <RotateCw class="size-5" />
            </span>
          </button>
          <span>{currentTime} - {totalDuration}</span>
          {#if streamStatus === "streaming"}
            <span class="badge badge-info badge-soft">Live streaming...</span>
          {:else if !isReady}
            <span class="badge badge-neutral badge-soft">Buffering...</span>
          {:else if streamStatus === "finalized"}
            <span class="badge badge-success badge-soft">Finalized</span>
          {/if}
        </div>

      <div class="flex items-center justify-end space-x-2">
        <a
          href={audioUrl}
          download
          class="btn btn-ghost btn-circle"
          class:btn-disabled={streamStatus !== "finalized" || !audioUrl || !isReady}
          aria-disabled={streamStatus !== "finalized" || !audioUrl || !isReady}
        >
          <span class="tooltip tooltip-left" data-tip="Download">
            <Download class="size-6" />
          </span>
        </a>
      </div>
    </div>

    <div bind:this={waveformContainer} class="flex-grow p-2"></div>
    <div class="px-2 pb-2">
      <input
        type="range"
        min="0"
        max="100"
        step="0.1"
        class="range range-primary range-sm"
        value={totalDurationSeconds > 0
          ? Math.min((currentTimeSeconds / totalDurationSeconds) * 100, 100)
          : 0}
        oninput={seekByPercent}
        disabled={!isReady}
      />
    </div>
  </div>

  {#if showSpectrogram}
    <div class="bg-black px-4 pb-4">
      <div
        bind:this={spectrogramContainer}
        id="spectrogram"
        class="flex-grow"
      ></div>
    </div>
  {/if}
</div>
