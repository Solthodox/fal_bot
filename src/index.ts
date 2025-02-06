import { Telegraf } from "telegraf";
import { FalPrompter, ImageSize } from "./fal_prompter";
import dotenv from "dotenv";
import axios from "axios";

async function main() {
  // Load environment variables
  dotenv.config();

  // Validate environment variables
  if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN must be provided in environment variables");
  }

  if (
    !process.env.TRIGGER_WORD ||
    !process.env.TRIGGER_WORD_ALIAS ||
    !process.env.MODEL_FILE ||
    !process.env.FAL_API_KEY
  ) {
    throw new Error(
      "TRIGGER_WORD, TRIGGER_WORD_ALIAS, and MODEL_FILE must be provided in environment variables"
    );
  }

  // // Initialize the bot
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Initialize the prompter
  const prompter = new FalPrompter(
    process.env.TRIGGER_WORD,
    process.env.TRIGGER_WORD_ALIAS,
    process.env.MODEL_FILE,
    process.env.FAL_API_KEY
  );

  // Command to set dimensions
  bot.command("setsize", async (ctx) => {
    const params = ctx.message.text.split(" ");
    if (params.length !== 2) {
      return ctx.reply(
        "Usage: /setsize <size>\n\n" +
          "Available sizes:\n" +
          "- landscape_4_3 (1024×768)\n" +
          "- landscape_16_9 (1024×576)\n" +
          "- square (576×576)\n" +
          "- square_hd (1024×1024)\n" +
          "- portrait_4_3 (768×1024)\n" +
          "- portrait_16_9 (576×1024)"
      );
    }

    const size = params[1];
    prompter.setSize(size as ImageSize);
    ctx.reply(`Image size set to ${size}`);
  });

  // Command to set number of images
  bot.command("setcount", async (ctx) => {
    const params = ctx.message.text.split(" ");
    if (params.length !== 2) {
      return ctx.reply("Usage: /setcount <number>\nExample: /setcount 4");
    }

    const count = parseInt(params[1]);
    if (isNaN(count) || count < 1 || count > 4) {
      return ctx.reply(
        "Invalid count. Please choose a number between 1 and 4."
      );
    }

    prompter.setNumImages(count);
    ctx.reply(`Number of images set to ${count}`);
  });

  // Command to show current settings
  bot.command("settings", (ctx) => {
    ctx.reply(
      "Current settings:\n" +
        `Size: ${prompter.imageSize}\n` +
        `Number of images: ${prompter.numImages}`
    );
  });

  // Handle errors
  bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}`, err);
    ctx.reply(
      "An error occurred while processing your message. Please try again later."
    );
  });

  // Add this utility function for delay between retries
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // Utility function to send photo with retries
  async function sendPhotoWithRetry(
    ctx: any,
    imageBuffer: Buffer,
    retries = 3,
    initialDelay = 1000
  ) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await ctx.replyWithPhoto({
          source: imageBuffer,
        });
        return true; // Success
      } catch (error) {
        if (attempt === retries) {
          throw error; // Rethrow if last attempt
        }
        console.log(
          `Attempt ${attempt} failed, retrying in ${
            initialDelay / 1000
          } seconds...`
        );
        await delay(initialDelay);
        initialDelay *= 2; // Exponential backoff
      }
    }
    return false;
  }

  // Start command handler
  bot.command("start", (ctx) => {
    ctx.reply(
      `Welcome! I'm a bot that processes messages using Fal AI.\n\n` +
        `To use me, send a message containing "${process.env.TRIGGER_WORD_ALIAS}" and I'll process it for you.`
    );
  });

  // Help command handler
  bot.command("help", (ctx) => {
    ctx.reply(
      "How to use this bot:\n\n" +
        `1. Include "${process.env.TRIGGER_WORD_ALIAS}" in your message\n` +
        "2. Send your message\n" +
        "3. Wait for the generated image(s)\n\n" +
        "Available commands:\n" +
        "/start - Start the bot\n" +
        "/ayuda - Show this help message\n" +
        "/setsize <size> - Set image size\n" +
        "/setcount <number> - Set number of images (1-4)\n" +
        "/settings - Show current settings\n\n" +
        "Available image sizes:\n" +
        "- landscape_4_3 (1024×768)\n" +
        "- landscape_16_9 (1024×576)\n" +
        "- square (576×576)\n" +
        "- square_hd (1024×1024)\n" +
        "- portrait_4_3 (768×1024)\n" +
        "- portrait_16_9 (576×1024)\n\n" +
        "Examples:\n" +
        "/setsize landscape_16_9 - Set to wide landscape\n" +
        "/setsize portrait_4_3 - Set to portrait\n" +
        "/setcount 4 - Generate 4 images per prompt"
    );
  });

  // Modify the message handler to use the retry function
  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    try {
      const messageText = ctx.message.text;
      const size = prompter.imageSize;
      const imageCount = prompter.numImages;

      const processingMessage = await ctx.reply(
        `Processing your message...\nGenerating ${imageCount} image(s) with size: ${size}`
      );

      try {
        const result = await prompter.prompt(messageText);

        if (result?.data?.images?.length > 0) {
          let successCount = 0;
          let failCount = 0;

          // Send all generated images with retry logic
          for (const image of result.data.images) {
            try {
              const imageResponse = await axios.get(image.url, {
                responseType: "arraybuffer",
                timeout: 30000, // 30 second timeout for downloading
              });

              try {
                await sendPhotoWithRetry(
                  ctx,
                  Buffer.from(imageResponse.data, "binary")
                );
                successCount++;
              } catch (sendError) {
                console.error("Failed to send image after retries:", sendError);
                failCount++;

                // Send image URL as fallback
                await ctx.reply(
                  `Couldn't send image directly. You can view it here: ${image.url}`
                );
              }

              // Add a small delay between sending images
              await delay(1000);
            } catch (downloadError) {
              console.error("Failed to download image:", downloadError);
              failCount++;
              await ctx.reply(
                `Failed to download image. You can view it here: ${image.url}`
              );
            }
          }

          // Send summary and prompt
          await ctx.reply(
            `Prompt used: ${messageText}\n` +
              `Successfully sent: ${successCount} image(s)\n` +
              (failCount > 0 ? `Failed to send: ${failCount} image(s)` : "")
          );
        } else {
          await ctx.reply("No images were generated in the response.");
        }

        await ctx.telegram.deleteMessage(
          ctx.chat.id,
          processingMessage.message_id
        );
      } catch (error) {
        // ... (rest of error handling remains the same)
      }
    } catch (error) {
      console.error("Error in message handler:", error);
      ctx.reply("An unexpected error occurred. Please try again later.");
    }
  });

  // Enable graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  // Start the bot
  try {
    await bot.launch();
    console.log("Bot is running...");
  } catch (err) {
    console.error("Error starting bot:", err);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
