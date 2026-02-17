/**
 * AI generated
 * SONARQUBE TO JSON BENCHMARK EXPORTER
 * Exportiert Code Smells im Vergleichsformat für LLMs.
 */

//const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// --- KONFIGURATION ---
const SONAR_URL = 'http://localhost:9000';
const AUTH_TOKEN = 'squ_fc122f630ab89ca62f31ab34641d4f6b5fac9d62'; // <-- Token hier rein
const AUTH_HEADER = { 'Authorization': 'Basic ' + Buffer.from(AUTH_TOKEN + ':').toString('base64') };
const OUTPUT_FILE = 'sonar_smell.json';
const ANEMIC_DOMAIN_ONLY = true; // Nur Klassen im 'domain' Package prüfen?

// --- MAPPING: Rule -> JSON Key ---
// Wir mappen die Sonar-Rules auf deine camelCase Keys für das JSON
const RULE_MAPPING = {
    'java:S1144': 'deadCode', 'java:S1481': 'deadCode', 'java:S1854': 'deadCode',
    'java:S1172': 'deadCode', 'java:S1068': 'deadCode', 'java:S1128': 'deadCode',
    
    'java:S1192': 'duplication', 'java:S4144': 'duplication',
    
    'java:S1940': 'negativeConditionals',
    
    'java:S1200': 'layerViolation', 'java:S7134': 'layerViolation',
    
    'java:S1448': 'misplacedResponsibility', 'java:S107': 'misplacedResponsibility',
    'java:S2972': 'misplacedResponsibility',
    
    'java:S2094': 'anemicEntity' // Rule-Teil
};

const ALL_RULES = Object.keys(RULE_MAPPING).join(',');

async function runJsonExport() {
    console.log("🌊 Starte JSON-Export für Benchmarking...");

    try {
        // 1. Projekte laden
        const projectsResp = await fetch(`${SONAR_URL}/api/components/search?qualifiers=TRK&ps=500`, { headers: AUTH_HEADER });
        const projectsData = await projectsResp.json();
        
        // Sortieren wie gewünscht
        const projects = projectsData.components.sort((a, b) => a.name.localeCompare(b.name));
        
        console.log(`⚓ ${projects.length} Projekte an Deck. Verarbeitung beginnt...`);

        const finalOutput = [];

        for (const project of projects) {
            // Projekt-Objekt vorbereiten
            let pName = project.name === 'st2-praktikum' ? 'st2_1' : project.name;
            const pKeySafe = encodeURIComponent(project.key);

            console.log(`   > Scanne ${pName}...`);

            // Temporärer Speicher für dieses Projekt: { "ClassName": { deadCode: [], ... } }
            const projectFileMap = {};

            // Hilfsfunktion: Stellt sicher, dass die Klasse und der Key existieren
            const addEntry = (filePath, jsonKey, value) => {
                // Nur den Klassennamen extrahieren (z.B. "Email" aus "src/.../Email.java")
                const className = path.basename(filePath, path.extname(filePath));
                
                if (!projectFileMap[className]) {
                    projectFileMap[className] = { class: className };
                }
                if (!projectFileMap[className][jsonKey]) {
                    projectFileMap[className][jsonKey] = [];
                }
                // Duplikate vermeiden
                if (!projectFileMap[className][jsonKey].includes(value)) {
                    projectFileMap[className][jsonKey].push(value);
                }
            };

            // ---------------------------------------------------------
            // SCHRITT A: Issues (Rules) laden
            // ---------------------------------------------------------
            let page = 1;
            while(true) {
                // Wir nutzen 'additionalFields=_all', um TextRanges (Start-Ende Zeilen) zu bekommen
                const issuesUrl = `${SONAR_URL}/api/issues/search?componentKeys=${pKeySafe}&rules=${ALL_RULES}&ps=500&p=${page}&additionalFields=_all`;
                const issuesResp = await fetch(issuesUrl, { headers: AUTH_HEADER });
                const issuesData = await issuesResp.json();
                
                if (!issuesData.issues || issuesData.issues.length === 0) break;

                issuesData.issues.forEach(issue => {
                    const jsonKey = RULE_MAPPING[issue.rule];
                    if (jsonKey) {
                        const filePath = issue.component.split(':').pop();
                        
                        // Zeilenbereich formatieren: "23-26" oder "42"
                        let rangeString = "";
                        if (issue.textRange) {
                            rangeString = `${issue.textRange.startLine}-${issue.textRange.endLine}`;
                        } else if (issue.line) {
                            rangeString = `${issue.line}`;
                        } else {
                            rangeString = "Class"; // Fallback für Klassen-Level Issues
                        }

                        addEntry(filePath, jsonKey, rangeString);
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
                        const fileName = file.name || "";

                        // 1. Grund-Logik: Komplexität <= 1 UND Methoden >= 1
                        const isAnemicLogic = (complexity <= 1 && methods >= 1);

                        // 2. NEUE FILTER:
                        // - Muss "solution" im Pfad haben (Case Insensitive zur Sicherheit)
                        const isInSolution = filePath.toLowerCase().includes('solution');
                        const isInDomain = filePath.toLowerCase().includes('domain');
                        const isCorrectLocation = isInDomain && isInSolution;
                        // - Darf NICHT "repository" im Dateinamen haben
                        const isRepository = fileName.toLowerCase().includes('repository');

                        if (isAnemicLogic && isCorrectLocation && !isRepository) {
                            addEntry(file.name, 'anemicEntity', "Class");
                        }
                    });
                }
            } catch (e) { /* Fehler ignorieren (z.B. 403) */ }

            // ---------------------------------------------------------
            // SCHRITT C: In JSON Struktur umwandeln
            // ---------------------------------------------------------
            const codeSmellsArray = Object.values(projectFileMap);

            // Nur hinzufügen, wenn es in diesem Projekt überhaupt Smells gab
            if (codeSmellsArray.length > 0) {
                finalOutput.push({
                    projektName: pName,
                    llm: "SonarQube",
                    codeSmells: codeSmellsArray
                });
            } else {
                 // Auch leere Projekte aufnehmen? Falls ja, einkommentieren:
                 /*
                 finalOutput.push({
                    projektName: pName,
                    llm: "SonarQube",
                    codeSmells: []
                 });
                 */
            }
        }

        // Speichern
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));
        console.log(`\n✅ JSON Benchmark-Datei erstellt: ${OUTPUT_FILE}`);

    } catch (error) {
        console.error("☠️  Fehler beim Navigieren:", error);
    }
}

runJsonExport();