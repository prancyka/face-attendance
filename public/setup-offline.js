const fs = require('fs');
const https = require('https');
const path = require('path');

const VENDOR_DIR = path.join(__dirname, 'public', 'vendor');
const MODELS_DIR = path.join(VENDOR_DIR, 'models');
const JS_DIR = path.join(VENDOR_DIR, 'js');
const CSS_DIR = path.join(VENDOR_DIR, 'css');

// Ensure directories exist
[VENDOR_DIR, MODELS_DIR, JS_DIR, CSS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const filesToDownload = [
    // === Core JS ===
    {
        url: 'https://cdn.tailwindcss.com?plugins=forms,container-queries',
        dest: path.join(JS_DIR, 'tailwind.js')
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
        dest: path.join(JS_DIR, 'face-api.min.js')
    },
    // === Admin Tools ===
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        dest: path.join(JS_DIR, 'xlsx.full.min.js')
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        dest: path.join(JS_DIR, 'jspdf.umd.min.js')
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
        dest: path.join(JS_DIR, 'jspdf.plugin.autotable.min.js')
    },
    // === Font Awesome CSS (Icons will gracefully degrade if WOFF2 fails, but CSS helps) ===
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
        dest: path.join(CSS_DIR, 'all.min.css')
    },

    // === Face-API Models (Tiny Face Detector) ===
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/tiny_face_detector_model-weights_manifest.json',
        dest: path.join(MODELS_DIR, 'tiny_face_detector_model-weights_manifest.json')
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/tiny_face_detector_model-shard1',
        dest: path.join(MODELS_DIR, 'tiny_face_detector_model-shard1')
    },

    // === Face-API Models (Face Landmark 68) ===
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/face_landmark_68_model-weights_manifest.json',
        dest: path.join(MODELS_DIR, 'face_landmark_68_model-weights_manifest.json')
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/face_landmark_68_model-shard1',
        dest: path.join(MODELS_DIR, 'face_landmark_68_model-shard1')
    },

    // === Face-API Models (Face Recognition) ===
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/face_recognition_model-weights_manifest.json',
        dest: path.join(MODELS_DIR, 'face_recognition_model-weights_manifest.json')
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/face_recognition_model-shard1',
        dest: path.join(MODELS_DIR, 'face_recognition_model-shard1')
    },
    {
        url: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/face_recognition_model-shard2',
        dest: path.join(MODELS_DIR, 'face_recognition_model-shard2')
    }
];

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
            console.log(`[SKIP] Already exists: ${path.basename(dest)}`);
            resolve();
            return;
        }

        const file = fs.createWriteStream(dest);
        const request = https.get(url, (response) => {
            // Handle redirects (like cdnjs unpkg)
            if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`[REDIRECT] ${url} -> ${response.headers.location}`);
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });

        // Set timeout
        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error(`Timeout downloading ${url}`));
        });
    });
}

async function startDownloads() {
    console.log(`Starting to download ${filesToDownload.length} files for offline use...\n`);
    let successCount = 0;
    
    for (const file of filesToDownload) {
        console.log(`[DOWNLOADING] ${file.url}...`);
        try {
            await downloadFile(file.url, file.dest);
            console.log(`[SUCCESS] Saved to ${path.basename(file.dest)}\n`);
            successCount++;
        } catch (err) {
            console.error(`[ERROR] Failed to download ${path.basename(file.dest)}: ${err.message}\n`);
        }
    }
    
    console.log(`\n=== DOWNLOAD COMPLETE ===`);
    console.log(`Successfully downloaded ${successCount} out of ${filesToDownload.length} files.`);
    console.log(`Everything is stored cleanly in the 'public/vendor' directory!`);
}

startDownloads();
