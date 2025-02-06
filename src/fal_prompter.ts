import { fal } from "@fal-ai/client";
export type ImageSize =
  | "landscape_4_3"
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_16_9";
export class FalPrompter {
  private triggerWord;
  private triggerWordAlias;
  private modelFile;
  public imageSize: ImageSize = "landscape_4_3";
  public numImages = 1;
  constructor(
    triggerWord: string,
    triggerWordAlias: string,
    modelFile: string,
    falKey: string
  ) {
    fal.config({
      credentials: falKey,
    });
    if (!triggerWord || !triggerWordAlias || !modelFile)
      throw new Error("Missing parameters");
    this.triggerWord = triggerWord;
    this.triggerWordAlias = triggerWordAlias;
    this.modelFile = modelFile;
  }

  public setSize(size: ImageSize): void {
    this.imageSize = size;
  }

  public setNumImages(numImages: number): void {
    this.numImages = numImages;
  }

  public async prompt(text: string) {
    text = this.replaceTriggerWord(text);
    const result = await fal.subscribe("fal-ai/flux-lora", {
      input: {
        prompt: text,
        loras: [
          {
            path: `https://v3.fal.media/files/${this.modelFile}.safetensors`,
            scale: 1,
          },
        ],
        image_size: this.imageSize,
        num_images: this.numImages,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          update.logs.map((log) => log.message).forEach(console.log);
        }
      },
    });
    console.log(result);
    console.log(result.data);
    console.log(result.requestId);
    return result;
  }

  private replaceTriggerWord(text: string): string {
    if (!text) throw new Error("No text provided");
    // Check if the word exists in the text
    if (!text.includes(this.triggerWordAlias)) {
      throw new Error(`Word "${this.triggerWordAlias}" not found in the text`);
    }
    const regex = new RegExp(this.triggerWordAlias, "g");
    return text.replace(regex, this.triggerWord);
  }
}
