require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Anthropic = require("@anthropic-ai/sdk"); // Für Claude
const OpenAI = require("openai"); // Für DeepSeek 

const currentMode = process.env.MODE || "TEST";
let geminiApiKey;
let claudeApiKey;
let deepSeekApiKey; // if we use the server based one
// AI handles
let genAI; // gemini
let claudeAI; 
let deepSeekAI;

let geminiModel; // dont set

// Settings
const REASONING = true; // LLM soll einene Grund geben warum es zu diesem Smell kam. 
const ADD_LINE_NUMBERS = true; //true = Mit Zeilennummern, false = Ohne
const MAXTOKEN = 15000 // Daumenregel Tokens * 3 (DeepSeek) ODER 4 (Claude / Gemini) = max Buchstabenlänge der Antwort https://api-docs.deepseek.com/quick_start/token_usage UND https://platform.claude.com/docs/en/about-claude/pricing UND https://ai.google.dev/gemini-api/docs/tokens?hl=de&lang=python

// An welche LLM? Nur gemini geht im Testmodus
const GEMINI = true;
const CLAUDE = true;
const DEEPSEEK = true;

const REPO_LIST_FILE = "folders.txt";
// Folder Crawler Einstellungen
const ALLOWED_EXTENSIONS = [".java"]; 
const IGNORE_DIRS = [
    "node_modules", ".git", ".idea", "target", "build", "bin", "promptLogs"
];

// checks for API keys and set up
function init() {
        if (currentMode === "PRODUCTION") {
        console.log("INFO: Production Mode: Paid API Key active.");
        geminiApiKey = process.env.GEMINI_PAID_KEY;
        // Existieren beide nur paid
        claudeApiKey = process.env.CLAUDE_KEY;
        deepSeekApiKey = process.env.DEEPSEEK_KEY;
        geminiModel = "gemini-3-pro-preview";
    } else {
        console.log("INFO: Test Mode: Free API Key active.");
        geminiApiKey = process.env.GEMINI_FREE_KEY;
        geminiModel = "gemini-2.5-flash";
        
    } 

    // Gemini Setup
    if (GEMINI) {
        if (!geminiApiKey) { console.error("ERROR: No Gemini Key"); process.exit(1); }
        genAI = new GoogleGenerativeAI(geminiApiKey);
        console.log("INFO: Gemini initialisiert.");
    }

    // Claude Setup
    if (CLAUDE) {
        if (!claudeApiKey) { console.error("ERROR: No Claude Key"); process.exit(1); }
        claudeAI = new Anthropic({
            apiKey: claudeApiKey, 
        });
        console.log("INFO: Claude initialisiert.");
    }

    // DeepSeek Setup (Via OpenAI SDK)
    if (DEEPSEEK) {
        if (!deepSeekApiKey) { console.error("ERROR: No DeepSeek Key"); process.exit(1); }
        deepSeekAI = new OpenAI({
            baseURL: 'https://api.deepseek.com', 
            apiKey: deepSeekApiKey
        });
        console.log("INFO: DeepSeek initialisiert.");
    }
}


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
            // Wenn Ordner ist: Prüfen ob ignoriert
            if (!IGNORE_DIRS.includes(file)) {
                readProjectFolder(fullPath, fileList);
            }
        } else {
            // Wenn Datei, Endung prüfen
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
    console.log(`INFO: ${fileList.length} Dateien gefunden.`);

    fileList.forEach(filePath => {
        try {
            const content = fs.readFileSync(filePath, "utf8");
            
            combinedContent += `\n\n--- FILE: ${filePath} ---\n`;

            if (ADD_LINE_NUMBERS) {
                // Mit Zeilennummern, weil KI schlechte Zeilenangaben gibt
                const lines = content.split(/\r?\n/);
                const numberedContent = lines.map((line, index) => {
                    return `${index + 1}: ${line}`;
                }).join('\n');
                
                combinedContent += numberedContent;

            } else {
                // Ohne Zeilennummern (Original, spart Tokens)
                combinedContent += content;
            }

        } catch (err) {
            console.warn(`WARNING: Fehler beim Lesen: ${filePath}`);
        }
    });

    return combinedContent;
}

function saveLog(prompt, responseText, modelName, projectName) {
    const logDir = "promptLogs";
    
    if (!fs.existsSync(logDir)){
        fs.mkdirSync(logDir);
    }

    const safeProjectName = projectName.replace(/[^a-zA-Z0-9-_]/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `log_${safeProjectName}_${timestamp}_${modelName}.txt`;
    const filePath = path.join(logDir, filename);

    const fileContent = `--- DATE: ${new Date().toLocaleString()} ---\n\n[PROMPT]:\n${prompt}\n\n[RESPONSE]:\n${responseText}\n-----------------------------------`;

    fs.writeFileSync(filePath, fileContent);
    console.log(`INFO: Log saved: ${filePath}`);
}

async function runAnalysis(targetDir) {
    // Prompt Ideen:
    // Smell Kontext - zwingend, besonders auch das man anemic entity nur pro gesamte Klasse haben kann x
    // struktur vorgeben wir die Antwort aussehen soll. Vielleicht als JSON?

    const smells = [
        "Duplication: duplizierte Codestücke die mehrmals vorkommen und eingespart werden könnten. Gib hierbei sowohl die duplizierte als auch die originale Zeile an. Bei längeren kopierten Abschnitten gib auch hier die Zeilen als Bereich an. ",
        "negative conditionals: Es handelt sich hierbei um negativ oder doppelt negativ formulierte Bedingungen und Variablen. Einfach formulierte Negierungen in if-Anweisungen sind okay solange sie verständlich sind. ",
        "dead code: Nicht genutzer Code. Klassen, Methoden und Variablen die nie aufgerufen werden. ", 
        "layer violation: Es wurde sich nicht an die Package und Ebenenstruktur gehalten. Zum Beispiel Zugriff auf den Domainlayer eines anderen Pakets.", 
        "missplaced resonsibility: Dieser Code ist an der falschen Stelle. Entweder gehört er in ein anderes Package oder in einen andere Schicht oder in eine andere Klasse.",
        "Shared persistency: Zugriff auf die Repositories der Domainschicht eines anderen Packages.",
        "Anemic Entity: Domain Entities in der Domainschicht die nur über Getter oder Setter verfügen aber sonst keine Funktionen. Ausgenommen sind Repositories. Für diesen Smell brauchst du keinen Zeilenangabe, da er für die gesamte Klasse gilt. Schreib einfach nur einmal -Anemic Entity- sonst zu der enstrechenden Datei"
        ];

    const instruction = `Du bist ein erfahrener Java-Reviewer.
        Architektur: 4-Layer (Eric Evans).
        Aufgabe: Finde folgende Smells: ${smells.join(" ")}.
        Regeln:
        1. ${REASONING ? "Begründe kurz jeden Fund." : "KEINE Begründungen."}
        4. Gruppiere nach Datei (mit Pfad). 
        2. Format unter der Datei je Smell: [Dateiname (ohne Pfad)] [Zeile(n) X]: [Smell] [Nur bei Duplizierung: die original Zeile(n)] ${REASONING ? ": [Begründung]" : ""}.
        3. Keine Code-Wiederholung, nur Referenzen.
        5. Wenn fertig, schreibe "ENDE". 
        ${ADD_LINE_NUMBERS ? "6. Nutze die Zeilenangaben die mitgeschickt worden sind." : ""}`;
    // Zielordner (Aktueller Ordner ".")
    const projectName = path.basename(targetDir);
    
    console.log(`INFO: Suche nach .java Dateien in: ${path.resolve(targetDir)}`);

    const allFiles = readProjectFolder(targetDir);
    
    if (allFiles.length === 0) {
        console.log("ERROR: Keine .java Dateien gefunden! Keine Callout gesendet");
        return;
    }

    const fullCodebase = readFileList(allFiles);

    const prompt = `${instruction}\n\n${fullCodebase}`;
    console.log("INFO: Sende prompts...");
    try {
    // Gemini
        if (GEMINI) {
            console.log("INFO: Sende an GEMINI... (Warte auf Antwort)");
            const model = genAI.getGenerativeModel({ 
                model: geminiModel, 
                generationConfig: { 
                    maxOutputTokens: MAXTOKEN, 
                    temperature: 0.7 // Standard
                }
            });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text() + "\nGenerated by " + geminiModel;

            console.log("INFO: Gemini fertig."); 
            saveLog(prompt, text, "Gemini", projectName);
        }
    } catch (error) {
        console.error("ERROR: ", error.message);
    }

    try {
    // Claude
        if (CLAUDE) {
            console.log("INFO: Sende an CLAUDE... (Warte auf Antwort)");
            const modelName = "claude-opus-4-5-20251101"; // Check Version
            let text = "";

            const stream = await claudeAI.messages.create({
                model: modelName,
                max_tokens: MAXTOKEN,
                messages: [{ role: "user", content: prompt }],
                stream: true, // HIER: Streaming aktiviert
            });

            // Wir hören den Stream ab, sagen aber nichts
            for await (const event of stream) {
                if (event.type === 'content_block_delta') {
                    const chunkText = event.delta.text;
                    text += chunkText; // Nur sammeln, nicht drucken!
                }
            }

            text = text + "\nGenerated by " + modelName;
            console.log("INFO: Claude fertig.");
            saveLog(prompt, text, "Claude", projectName);
        }

    } catch (error) {
        console.error("ERROR: ", error.message);
    }

    try {
    // DEEPSEEK
        if (DEEPSEEK) {
            console.log("INFO: Sende an DEEPSEEK... (Warte auf Antwort)");
            const modelName = "deepseek-reasoner"; 

            const completion = await deepSeekAI.chat.completions.create({
                model: modelName,
                messages: [{ role: "user", content: prompt }],
                stream: false, // Explizit ausschalten
                max_tokens: MAXTOKEN,
            });

            const text = completion.choices[0].message.content + "\nGenerated by " +  modelName;
            console.log("INFO: DeepSeek fertig.");
            saveLog(prompt, text, "DeepSeek", projectName);
        }
    } catch (error) {
        console.error("ERROR: ", error.message);
    }
}

// Batchfunktion
async function batchProcessing() {
    init(); 
    
    if (!fs.existsSync(REPO_LIST_FILE)) {
        console.error(`ERROR: Datei '${REPO_LIST_FILE}' nicht gefunden.`);
        process.exit(1);
    }
    
    const fileContent = fs.readFileSync(REPO_LIST_FILE, 'utf-8');

    // teilen für jede Zeile, # als kommentar
    const folders = fileContent
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith("#"));

    console.log(`INFO: ${folders.length} Projekte identifiziert.`);

    // Für jede Datei calls schicken
    for (const [index, folderPath] of folders.entries()) {
        console.log(`------------------------------------------------`);
        console.log(`Processing ${index + 1} / ${folders.length}`);
        console.log(`------------------------------------------------`);
        
        await runAnalysis(folderPath);
    }

    console.log("INFO: Alle Projekte analysiert.");
}

// start:
batchProcessing();