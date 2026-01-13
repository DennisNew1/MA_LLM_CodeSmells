/**
 * AI GENERATED
 * SONARQUBE CSV DETAIL REPORTER
 * Erzeugt eine CSV mit Projekt-Headern und Zeilennummern pro Datei.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// --- KONFIGURATION ---
const SONAR_URL = 'http://localhost:9000';
const AUTH_TOKEN = 'squ_fc122f630ab89ca62f31ab34641d4f6b5fac9d62'; // <-- Token hier rein
const AUTH_HEADER = { 'Authorization': 'Basic ' + Buffer.from(AUTH_TOKEN + ':').toString('base64') };
const OUTPUT_FILE = 'sonar_smell_details.csv';

// --- SMELL DEFINITIONEN ---
const SMELL_DEFINITIONS = {
    'Dead Code': [
        'java:S1144', 'java:S1481', 'java:S1854', 
        'java:S1172', 'java:S1068', 'java:S1128'
    ],
    'Duplication': [ 
        'java:S1192', 'java:S4144' // Zeilenbasierte Duplikate
    ],
    'Avoid Negative Cond.': ['java:S1940'],
    'Layer Violation': ['java:S1200', 'java:S7134'],
    'Misplaced Resp.': ['java:S1448', 'java:S1200', 'java:S107', 'java:S2972'],
    'Anemic Entity': ['java:S2094'] // Rule + Heuristik
};

// Hilfs-Map: Rule -> Kategorie
const RULE_TO_CATEGORY = {};
Object.entries(SMELL_DEFINITIONS).forEach(([cat, rules]) => {
    rules.forEach(rule => RULE_TO_CATEGORY[rule] = cat);
});
const ALL_RULES = Object.keys(RULE_TO_CATEGORY).join(',');

// CSV Spalten-Header (Reihenfolge)
const CSV_COLUMNS = [
    'Datei', 
    'Dead Code', 
    'Duplication', 
    'Avoid Negative Cond.', 
    'Layer Violation', 
    'Misplaced Resp.', 
    'Anemic Entity'
];

async function runCsvAnalysis() {
    console.log("🌊 Starte CSV-Detail-Analyse...");
    
    // CSV Header initialisieren
    let csvContent = CSV_COLUMNS.join(';') + '\n';

    try {
        // 1. Projekte laden
        const projectsResp = await fetch(`${SONAR_URL}/api/components/search?qualifiers=TRK&ps=500`, { headers: AUTH_HEADER });
        const projectsData = await projectsResp.json();
        const projects = projectsData.components;

        // Sortierung sicherstellen (wie gewünscht)
        projects.sort((a, b) => a.name.localeCompare(b.name));

        console.log(`⚓ ${projects.length} Projekte gefunden.`);

        for (const project of projects) {
            let pName = project.name;
            if (pName === 'st2-praktikum') pName = 'st2_1'; // Umbenennung
            
            const pKeySafe = encodeURIComponent(project.key);
            console.log(`   > Verarbeite ${pName}...`);

            // Datenspeicher für dieses Projekt: { "Dateiname": { "Dead Code": [12, 15], ... } }
            const fileMatrix = {};

            // Hilfsfunktion zum Initialisieren einer Datei im Speicher
            const ensureFileEntry = (filePath) => {
                if (!fileMatrix[filePath]) {
                    fileMatrix[filePath] = {};
                    CSV_COLUMNS.slice(1).forEach(col => fileMatrix[filePath][col] = []);
                }
            };

            // ---------------------------------------------------------
            // SCHRITT A: Issues holen (Zeilennummern)
            // ---------------------------------------------------------
            let page = 1;
            while(true) {
                const issuesUrl = `${SONAR_URL}/api/issues/search?componentKeys=${pKeySafe}&rules=${ALL_RULES}&ps=500&p=${page}`;
                const issuesResp = await fetch(issuesUrl, { headers: AUTH_HEADER });
                const issuesData = await issuesResp.json();
                
                if (!issuesData.issues || issuesData.issues.length === 0) break;

                issuesData.issues.forEach(issue => {
                    const category = RULE_TO_CATEGORY[issue.rule];
                    if (category) {
                        // Dateinamen bereinigen (nur den Dateinamen, nicht den ganzen Pfad, für bessere Lesbarkeit in Tabelle)
                        const fullPath = issue.component.split(':').pop(); // Entfernt Projekt-Key
                        const fileName = path.basename(fullPath); // Holt nur "Klasse.java"
                        
                        ensureFileEntry(fileName);
                        
                        // Zeilennummer hinzufügen (oder "0" bei Dateiebene)
                        if (issue.line) {
                            fileMatrix[fileName][category].push(issue.line);
                        }
                    }
                });

                if (issuesData.issues.length < 500) break;
                page++;
            }

            // ---------------------------------------------------------
            // SCHRITT B: Anemic Entities (Heuristik)
            // ---------------------------------------------------------
            try {
                const metricsUrl = `${SONAR_URL}/api/measures/component_tree?component=${pKeySafe}&metricKeys=functions,cognitive_complexity,ncloc&qualifiers=FIL&ps=500`;
                const metricsResp = await fetch(metricsUrl, { headers: AUTH_HEADER });
                if (metricsResp.ok) {
                    const metricsData = await metricsResp.json();
                    (metricsData.components || []).forEach(file => {
                        const getVal = (k) => {
                            const m = file.measures ? file.measures.find(x => x.metric === k) : null;
                            return m ? Number(m.value) : 0;
                        };
                        
                        const complexity = getVal('cognitive_complexity');
                        const methods = getVal('functions');
                        const filePath = file.path || file.key;

                        // Logik: Komplexität <= 1 UND Methoden >= 1
                        const isAnemic = (complexity <= 1 && methods >= 1);
                        const isDomain = filePath.toLowerCase().includes('domain'); // Filter optional

                        // Falls Heuristik zutrifft (und optional Domain-Filter)
                        if (isAnemic && isDomain) {
                            const fileName = path.basename(file.name);
                            ensureFileEntry(fileName);
                            // Markierung setzen (da es keine Zeilennummer gibt, nehmen wir "Class")
                            if (!fileMatrix[fileName]['Anemic Entity'].includes('Class')) {
                                fileMatrix[fileName]['Anemic Entity'].push('Class');
                            }
                        }
                    });
                }
            } catch (e) { /* Ignore Access Errors */ }


            // ---------------------------------------------------------
            // SCHRITT C: In CSV schreiben (Formatierung)
            // ---------------------------------------------------------
            
            // 1. Projekt-Überschrift Zeile (Fett gedruckt in Excel durch Formatierung, hier reine Textzeile)
            // Format: "ProjektName";"";"";...
            csvContent += `"${pName}";;;;;;\n`;

            // 2. Dateien sortieren
            const sortedFiles = Object.keys(fileMatrix).sort();

            // 3. Zeilen generieren
            if (sortedFiles.length === 0) {
                // Optional: Zeile für "Keine Smells"
                // csvContent += `(Keine Smells);;;;;;\n`; 
            } else {
                sortedFiles.forEach(fileName => {
                    const rowData = fileMatrix[fileName];
                    
                    const rowString = CSV_COLUMNS.map((col, index) => {
                        if (index === 0) return `"${fileName}"`; // Dateiname
                        
                        // Zeilennummern holen, sortieren und unique machen
                        const lines = [...new Set(rowData[col])].sort((a, b) => {
                            if (typeof a === 'string') return -1; // "Class" nach vorne
                            return a - b;
                        });

                        if (lines.length === 0) return "";
                        // Format: "33, 55" (Mit Anführungszeichen für CSV)
                        return `"${lines.join(', ')}"`;
                    }).join(';');

                    csvContent += rowString + '\n';
                });
            }
        }

        // Speichern
        fs.writeFileSync(OUTPUT_FILE, csvContent);
        console.log(`\n✅ CSV Export erfolgreich: ${OUTPUT_FILE}`);

    } catch (error) {
        console.error("Fehler:", error);
    }
}

runCsvAnalysis();