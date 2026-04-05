<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { detectWebGPU } from "$lib/client/utils";
  import SelectControl from "$lib/client/components/SelectControl.svelte";
  import TextareaControl from "$lib/client/components/TextareaControl.svelte";
  import RangeControl from "$lib/client/components/RangeControl.svelte";
  import AudioPlayer from "$lib/client/components/AudioPlayer.svelte";
  import { toaster } from "$lib/client/toaster";
  import GenerateButton from "./GenerateButton.svelte";
  import ExecutionPlacePicker from "./ExecutionPlacePicker.svelte";
  import VersionChecker from "./VersionChecker.svelte";
  import { profile } from "./store.svelte";
  import { generate, type GenerationHandle } from "./generate";

  let webgpuSupported = $state(false);
  onMount(() => {
    webgpuSupported = detectWebGPU();
  });

  let loading = $state(false);
  let voiceUrl = $state("");
  let generationHandle: GenerationHandle | null = $state(null);

  onDestroy(() => {
    generationHandle?.dispose();
  });

  const process = async () => {
    if (loading) return;
    if (!profile.text) return;

    loading = true;
    voiceUrl = "";
    try {
      generationHandle?.dispose();
      generationHandle = await generate(profile);
      voiceUrl = generationHandle.audioUrl;
      await generationHandle.done;
      voiceUrl = generationHandle.audioUrl;
      toaster.success("Audio generated successfully");
    } catch (error) {
      console.error(error);
      toaster.error((error as any).message ?? "An error occurred, see console");
    } finally {
      loading = false;
    }
  };
</script>

<div class="space-y-4">
  <VersionChecker />

  <h2 class="text-xl font-bold">Input</h2>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-1">
    <ExecutionPlacePicker />

    <SelectControl
      bind:value={profile.acceleration}
      disabled={profile.executionPlace === "api"}
      title={profile.executionPlace === "browser"
        ? "Acceleration"
        : "Acceleration (Browser only)"}
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

    <GenerateButton {loading} onclick={() => process()} />
  </div>

  {#if loading || voiceUrl !== ""}
    <div class="space-y-4 pt-2">
      <h2 class="text-xl font-bold">Output</h2>
      <AudioPlayer
        audioUrl={voiceUrl}
        showSpectrogram={true}
        streamStatus={loading ? "streaming" : "finalized"}
      />
    </div>
  {/if}
</div>
