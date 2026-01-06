require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const currentMode = process.env.MODE || "TEST";
let apiKey;

if (currentMode === "PRODUCTION") {
    console.log("INFO: Production Mode: Paid API Key active.");
    apiKey = process.env.GEMINI_PAID_KEY;
} else {
    console.log("INFO: Test Mode: Free API Key active.");
    apiKey = process.env.GEMINI_FREE_KEY;
} 

if (!apiKey) {
    console.error("Error: No API key found in .env");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const ALLOWED_EXTENSIONS = [".java"]; 

const IGNORE_DIRS = [
    "node_modules", ".git", ".idea", "target", "build", "bin", "promptLogs"
];

// Project Crawler
function readProjectFolder(dirPath, fileList = []) {
    let files;
    try {
        files = fs.readdirSync(dirPath);
    } catch (err) {
        console.warn(`Warning: Kann Ordner nicht öffnen: ${dirPath}`);
        return fileList;
    }

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        let stat;
        
        try {
             stat = fs.statSync(fullPath);
        } catch (e) { return; } // Fehlerhafte Links ignorieren

        if (stat.isDirectory()) {
            // Wenn es ein Ordner ist: Prüfen ob ignoriert
            if (!IGNORE_DIRS.includes(file)) {
                readProjectFolder(fullPath, fileList);
            }
        } else {
            // Wenn es eine Datei ist: Prüfen wir die Endung!
            const extension = path.extname(file).toLowerCase();
            
            if (ALLOWED_EXTENSIONS.includes(extension)) {
                fileList.push(fullPath);
            }
        }
    });

    return fileList;
}

function readFileList(fileList) {
    let combinedContent = "";
    console.log(`INFO: länge Filelist ${fileList.length} `);

    fileList.forEach(filePath => {
        try {
            const content = fs.readFileSync(filePath, "utf8");
            combinedContent += `\n\n--- FILE: ${filePath} ---\n`;
            combinedContent += content;
        } catch (err) {
            console.warn(`WARNING: Fehler beim Lesen: ${filePath}`);
        }
    });

    return combinedContent;
}


function saveLog(prompt, responseText) {
    const logDir = "promptLogs";
    
    if (!fs.existsSync(logDir)){
        fs.mkdirSync(logDir);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `log_${timestamp}.txt`;
    const filePath = path.join(logDir, filename);

    const fileContent = `--- DATE: ${new Date().toLocaleString()} ---\n\n[PROMPT]:\n${prompt}\n\n[RESPONSE]:\n${responseText}\n-----------------------------------`;

    fs.writeFileSync(filePath, fileContent);
    console.log(`INFO: Log saved: ${filePath}`);
}

async function runAnalysis() {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const smells = [
        "negative conditionals",
         "dead code", 
         "layer violation", 
         "missplaced resonsibility",
         "Shared persistency",
         "Anemic Entity"
        ];
    const instruction = `Du bist Javaentwickler und musst diese Code Smells finden: ${smells.toString()}.
    Es wird die 4 schichtige Architektur nach Eric Evans genutzt. 
    Liste mir jeden Verstoß mit Smellname und Zeile pro Datei auf. Das ist der Code:`;
    
    // Zielordner (Aktueller Ordner ".")
    const targetDir = "C:/workspace/Masterarbeit/Repositories/ST2M4_group_13fb5450-bcb2-4392-bce6-c331d6d2b317"; 
    
    console.log(`INFO: Suche nach .java Dateien in: ${path.resolve(targetDir)}`);

    const allFiles = readProjectFolder(targetDir);
    
    if (allFiles.length === 0) {
        console.log("ERROR: Keine .java Dateien gefunden! Keine Callout gesendet");
        return;
    }

    const fullCodebase = readFileList(allFiles);

    const prompt = `${instruction}\n\n${fullCodebase}`;
    console.log("INFO: Sende prompt...");
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;

        //const response = {};
        //response.text =  () => "some text";
        console.log(response.text());

        saveLog(prompt, response.text());
    } catch (error) {
        console.error("ERROR:", error.message);
    }
}

runAnalysis();