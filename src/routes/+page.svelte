<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { detectWebGPU } from "$lib/client/utils";
  import SelectControl from "$lib/client/components/SelectControl.svelte";
  import TextareaControl from "$lib/client/components/TextareaControl.svelte";
  import RangeControl from "$lib/client/components/RangeControl.svelte";
  import AudioPlayer from "$lib/client/components/AudioPlayer.svelte";
  import { toaster } from "$lib/client/toaster";
  import GenerateButton from "./GenerateButton.svelte";
  import VersionChecker from "./VersionChecker.svelte";
  import { profile } from "./store.svelte";
  import { generate, type GenerationHandle } from "./generate";

  let webgpuSupported = $state(false);
  onMount(() => {
    webgpuSupported = detectWebGPU();
  });

  let loading = $state(false);
  let hasOutput = $state(false);
  let generationPhase = $state<"idle" | "streaming" | "processing" | "finalized" | "error">("idle");
  let loadingFromUrl = $state(false);
  let sourceUrl = $state("");
  let sourceChapter = $state("");
  let voiceUrl = $state("");
  let generationHandle: GenerationHandle | null = $state(null);
  let generationRunId = $state(0);

  onDestroy(() => {
    generationHandle?.dispose();
  });

  const loadFromUrl = async () => {
    if (loadingFromUrl) return;
    if (!sourceUrl.trim()) {
      toaster.error("Please provide a source URL");
      return;
    }

    loadingFromUrl = true;
    try {
      const chapter = sourceChapter.trim();
      const response = await fetch("/api/v1/text/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(profile.apiKey
            ? {
                Authorization: `Bearer ${profile.apiKey}`,
              }
            : {}),
        },
        body: JSON.stringify({
          url: sourceUrl.trim(),
          ...(chapter ? { chapter: Number(chapter) } : {}),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to load text from URL");
      }

      profile.text = payload.text;
      toaster.success(`Loaded text from URL${payload.title ? `: ${payload.title}` : ""}`);
    } catch (error) {
      console.error(error);
      toaster.error((error as any).message ?? "Failed to load text from URL");
    } finally {
      loadingFromUrl = false;
    }
  };

  const process = async () => {
    if (loading) return;
    if (!profile.text) return;

    const runId = generationRunId + 1;
    generationRunId = runId;

    loading = true;
    hasOutput = true;
    generationPhase = profile.generationMode === "streaming" ? "streaming" : "processing";
    voiceUrl = "";

    try {
      generationHandle?.dispose();
      generationHandle = null;

      const handle = await generate(profile);
      if (runId !== generationRunId) {
        handle.dispose();
        return;
      }

      generationHandle = handle;
      voiceUrl = handle.audioUrl;

      await handle.done;
      if (runId !== generationRunId) {
        return;
      }

      voiceUrl = handle.audioUrl;
      generationPhase = "finalized";
      toaster.success("Audio generated successfully");
    } catch (error) {
      if (runId !== generationRunId) {
        return;
      }

      const message = (error as any)?.message ?? "An error occurred, see console";
      const isAbort =
        (error as any)?.name === "AbortError" ||
        (typeof message === "string" && message.toLowerCase().includes("aborted"));

      if (isAbort) {
        generationPhase = voiceUrl ? "finalized" : "idle";
        return;
      }

      console.error(error);
      generationPhase = "error";
      toaster.error(message);
    } finally {
      if (runId === generationRunId) {
        loading = false;
      }
    }
  };

  const stopGeneration = () => {
    if (!loading) return;

    generationRunId += 1;
    generationHandle?.abort();
    loading = false;
    generationPhase = voiceUrl ? "finalized" : "idle";
    toaster.success("Generation stopped");
  };
</script>

<div class="space-y-4">
  <VersionChecker />

  <h2 class="text-xl font-bold">Input</h2>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-1">
    <fieldset class="fieldset w-full">
      <legend class="fieldset-legend">Generation mode</legend>
      <select class="select w-full" bind:value={profile.generationMode}>
        <option value="streaming">Streaming (progressive playback)</option>
        <option value="normal">Normal (single final file)</option>
      </select>
    </fieldset>

    <fieldset class="fieldset w-full">
      <legend class="fieldset-legend">Input source</legend>
      <select class="select w-full" bind:value={profile.inputSource}>
        <option value="text">Custom text</option>
        <option value="url">Load from URL</option>
      </select>
    </fieldset>

    <SelectControl
      bind:value={profile.acceleration}
      title="Acceleration"
      selectClass="w-full"
    >
      <option value="cpu">CPU</option>
      {#if webgpuSupported}
        <option value="webgpu">WebGPU (Faster)</option>
      {:else}
        <option disabled>WebGPU (not supported by your browser)</option>
      {/if}
    </SelectControl>
  </div>

  {#if profile.inputSource === "url"}
    <div class="space-y-2 rounded-md border border-base-300 p-3">
      <h3 class="font-semibold">Load from URL</h3>
      <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_160px_auto]">
        <input
          class="input input-bordered w-full"
          placeholder="https://example.com/chapter-123"
          bind:value={sourceUrl}
        />
        <input
          class="input input-bordered w-full"
          placeholder="Chapter (optional)"
          inputmode="numeric"
          bind:value={sourceChapter}
        />
        <button
          class="btn btn-outline"
          onclick={() => loadFromUrl()}
          disabled={loadingFromUrl}
        >
          {loadingFromUrl ? "Loading..." : "Load from URL"}
        </button>
      </div>
    </div>
  {/if}

  <TextareaControl
    bind:value={profile.text}
    title="Text to process"
    helpText="You can add synthetic pauses by adding a silence tags measured in seconds. E.g. Hello[1s]Kokoro[0.2s]Web"
    textareaClass="w-full"
  />

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <RangeControl
      bind:value={profile.speed}
      hideValue={true}
      title={`Speed ${profile.speed}x`}
      inputClass="w-full max-w-[400px]"
      min="0.1"
      max="2"
      step="0.1"
    />

    <div class="space-y-2">
      <GenerateButton {loading} onclick={() => process()} />
      {#if loading}
        <button class="btn btn-outline btn-error w-full" onclick={stopGeneration}>
          Stop generation
        </button>
      {/if}
    </div>
  </div>

  {#if hasOutput}
    <div class="space-y-2 rounded-xl border border-base-300 bg-base-100 p-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">Player</h2>
        {#if generationPhase === "streaming"}
          <span class="badge badge-info badge-soft">Generating…</span>
        {:else if generationPhase === "processing"}
          <span class="badge badge-warning badge-soft">Finishing…</span>
        {:else if generationPhase === "finalized"}
          <span class="badge badge-success badge-soft">Done</span>
        {:else if generationPhase === "error"}
          <span class="badge badge-error badge-soft">Failed</span>
        {/if}
      </div>
      <AudioPlayer
        audioUrl={voiceUrl}
        showSpectrogram={false}
        streamStatus={generationPhase === "streaming"
          ? "streaming"
          : generationPhase === "finalized"
            ? "finalized"
            : "idle"}
      />
    </div>
  {/if}
</div>
