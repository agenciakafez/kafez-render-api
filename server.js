const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 8080;
const OUTPUT_DIR = path.join(__dirname, "outputs");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Kafez Render API",
    version: "cuts-v1"
  });
});

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(filepath);

    client
      .get(url, (response) => {
        response.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", reject);
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || error.message));
      }

      resolve({ stdout, stderr });
    });
  });
}

app.post("/render", async (req, res) => {
  try {
    const { videos } = req.body;

    if (!videos || !Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({
        error: "Envie um array de vídeos em videos"
      });
    }

    const jobId = Date.now().toString();
    const jobDir = path.join(OUTPUT_DIR, jobId);

    fs.mkdirSync(jobDir);

    const processedVideos = [];

    for (let i = 0; i < videos.length; i++) {
      const item = videos[i];

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

      let cutCommand = "";

      if (end !== null && end > start) {
        const duration = end - start;

        cutCommand = `ffmpeg -y -ss ${start} -i "${inputPath}" -t ${duration} -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -c:v libx264 -preset veryfast -crf 23 -c:a aac -ar 44100 -ac 2 "${cutPath}"`;
      } else {
        cutCommand = `ffmpeg -y -i "${inputPath}" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -c:v libx264 -preset veryfast -crf 23 -c:a aac -ar 44100 -ac 2 "${cutPath}"`;
      }

      await runCommand(cutCommand);
      processedVideos.push(cutPath);
    }

    const listPath = path.join(jobDir, "list.txt");

    const listContent = processedVideos
      .map((file) => `file '${file}'`)
      .join("\n");

    fs.writeFileSync(listPath, listContent);

    const outputPath = path.join(jobDir, "output.mp4");

    const concatCommand = `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`;

    await runCommand(concatCommand);

    res.json({
      status: "done",
      message: "Vídeo renderizado com cortes",
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
