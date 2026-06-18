const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
app.use(express.json({ limit: "100mb" }));

const PORT = process.env.PORT || 8080;
const OUTPUT_DIR = path.join(__dirname, "outputs");

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Kafez Render API",
    version: "timeline-v1"
  });
});

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(filepath);

    client.get(url, (response) => {
      if (response.statusCode >= 400) {
        return reject(new Error(`Erro ao baixar arquivo: ${response.statusCode}`));
      }

      response.pipe(file);

      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", reject);
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve({ stdout, stderr });
    });
  });
}

function escapeText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function hexToDrawtextColor(color) {
  if (!color) return "white";
  return color.replace("#", "0x");
}

app.post("/render", async (req, res) => {
  try {
    const { videos, audio, music, texts = [] } = req.body;

    if (!videos || !Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({
        error: "Envie um array de vídeos em videos"
      });
    }

    const jobId = Date.now().toString();
    const jobDir = path.join(OUTPUT_DIR, jobId);
    fs.mkdirSync(jobDir);

    const sortedVideos = [...videos].sort((a, b) => {
      return (a.order || 0) - (b.order || 0);
    });

    const processedVideos = [];

    for (let i = 0; i < sortedVideos.length; i++) {
      const item = sortedVideos[i];

      const videoUrl = typeof item === "string" ? item : item.url;
      const start = typeof item === "object" ? item.start || 0 : 0;
      const end = typeof item === "object" ? item.end : null;

      if (!videoUrl) {
        return res.status(400).json({
          error: `Vídeo ${i + 1} sem URL`
        });
      }

      const inputPath = path.join(jobDir, `input_${i}.mp4`);
      const cutPath = path.join(jobDir, `cut_${i}.mp4`);

      await downloadFile(videoUrl, inputPath);

      const durationPart = end !== null && end > start ? `-t ${end - start}` : "";

      const command = `
        ffmpeg -y -ss ${start} -i "${inputPath}" ${durationPart}
        -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1"
        -r 30
        -c:v libx264
        -preset veryfast
        -crf 23
        -c:a aac
        -ar 44100
        -ac 2
        "${cutPath}"
      `;

      await runCommand(command);
      processedVideos.push(cutPath);
    }

    const listPath = path.join(jobDir, "list.txt");
    const concatPath = path.join(jobDir, "concat.mp4");

    fs.writeFileSync(
      listPath,
      processedVideos.map((file) => `file '${file}'`).join("\n")
    );

    await runCommand(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}"`);

    let currentVideoPath = concatPath;

    if (texts && Array.isArray(texts) && texts.length > 0) {
      const textOutputPath = path.join(jobDir, "with_text.mp4");

      const drawtextFilters = texts.map((t) => {
        const text = escapeText(t.text);
        const fontSize = t.fontSize || 64;
        const color = hexToDrawtextColor(t.color || "#FFFFFF");
        const start = t.start || 0;
        const end = t.end || 9999;

        let x = t.x || "(w-text_w)/2";
        let y = t.y || "h-350";

        if (x === "center") x = "(w-text_w)/2";
        if (x === "left") x = "80";
        if (x === "right") x = "w-text_w-80";

        if (y === "center") y = "(h-text_h)/2";
        if (y === "bottom") y = "h-350";
        if (y === "top") y = "160";

        const box = t.backgroundColor ? ":box=1:boxcolor=black@0.45:boxborderw=30" : "";

        return `drawtext=text='${text}':fontcolor=${color}:fontsize=${fontSize}:x=${x}:y=${y}:enable='between(t,${start},${end})'${box}`;
      }).join(",");

      await runCommand(`
        ffmpeg -y -i "${currentVideoPath}"
        -vf "${drawtextFilters}"
        -c:v libx264
        -preset veryfast
        -crf 23
        -c:a copy
        "${textOutputPath}"
      `);

      currentVideoPath = textOutputPath;
    }

    let audioInputs = [];
    let filterAudio = "";
    let mapAudio = "";

    if (audio?.url || music?.url) {
      const finalPath = path.join(jobDir, "output.mp4");

      let command = `ffmpeg -y -i "${currentVideoPath}"`;

      if (audio?.url) {
        const audioPath = path.join(jobDir, "audio.mp3");
        await downloadFile(audio.url, audioPath);
        command += ` -i "${audioPath}"`;
        audioInputs.push({
          index: audioInputs.length + 1,
          volume: audio.volume ?? 1
        });
      }

      if (music?.url) {
        const musicPath = path.join(jobDir, "music.mp3");
        await downloadFile(music.url, musicPath);
        command += ` -i "${musicPath}"`;
        audioInputs.push({
          index: audioInputs.length + 1,
          volume: music.volume ?? 0.15
        });
      }

      if (audioInputs.length === 1) {
        filterAudio = `-filter_complex "[${audioInputs[0].index}:a]volume=${audioInputs[0].volume}[aout]"`;
      }

      if (audioInputs.length === 2) {
        filterAudio = `-filter_complex "[${audioInputs[0].index}:a]volume=${audioInputs[0].volume}[a1];[${audioInputs[1].index}:a]volume=${audioInputs[1].volume}[a2];[a1][a2]amix=inputs=2:duration=longest[aout]"`;
      }

      mapAudio = `-map 0:v -map "[aout]"`;

      command += `
        ${filterAudio}
        ${mapAudio}
        -c:v copy
        -c:a aac
        -shortest
        "${finalPath}"
      `;

      await runCommand(command);
      currentVideoPath = finalPath;
    } else {
      const finalPath = path.join(jobDir, "output.mp4");
      fs.copyFileSync(currentVideoPath, finalPath);
      currentVideoPath = finalPath;
    }

    res.json({
      status: "done",
      message: "Vídeo renderizado com timeline completa",
      jobId,
      output: `/outputs/${jobId}/output.mp4`,
      url: `${req.protocol}://${req.get("host")}/outputs/${jobId}/output.mp4`
    });

  } catch (error) {
    res.status(500).json({
      error: "Erro ao renderizar vídeo",
      details: error.message
    });
  }
});

app.use("/outputs", express.static(OUTPUT_DIR));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
