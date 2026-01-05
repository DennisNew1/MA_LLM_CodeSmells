/**
 * SONARQUBE SMELL COLLECTOR
 * Dieses Skript zieht Code Smells basierend auf der definierten Konfiguration.
 * KI Wurde hierfür teilweise genutzt
 */

const fs = require('fs');

// KONFIGURATION
const SONAR_URL = 'http://localhost:9000';
const AUTH_TOKEN = 'squ_fc122f630ab89ca62f31ab34641d4f6b5fac9d62'; // aus Gründen funktioneren nur UserTokens keine globalen mit entsprechenend Rechten
const AUTH_HEADER = { 'Authorization': 'Basic ' + Buffer.from(AUTH_TOKEN + ':').toString('base64') };
const CSV_FILENAME = 'sonar_report.csv';

// 1. Definition der "Smell-Kategorien" anhand der Tabelle
const SMELL_DEFINITIONS = {
    'Dead Code': [
        'java:S1144', 'java:S1481', 'java:S1854', 
        'java:S1172', 'java:S1068', 'java:S1128'
    ],
    'Duplication': [
        'java:S1192', 'java:S4144' 
        // CPD (Copy Paste Detector) wird separat über Metriken geholt
    ],
    'Avoid Negative Conditionals': ['java:S1940'],
    'Layer Violation': ['java:S1200'],
    'Misplaced Responsibility': ['java:S1448', 'java:S1200', 'java:S107', 'java:S2972'],
    'Anemic Entity (Rule)': ['java:S2094'] 
    // 'Shared Persistency' ist Custom und hier nicht via Standard-Rules abfragbar
};

// Alle Rules sammeln für einen effizienten API Call
const ALL_RULES = Object.values(SMELL_DEFINITIONS).flat().join(',');

async function runAnalysis() {
    console.log("Starte Abfrage aller Projekte...");
    
    try {
        // SCHRITT 1: Alle Projekte holen
        const projectsResp = await fetch(`${SONAR_URL}/api/components/search?qualifiers=TRK&ps=500`, { headers: AUTH_HEADER });
        const projectsData = await projectsResp.json();
        const projects = projectsData.components;

        console.log(`${projects.length} Projekte gefunden. Starte Detailanalyse...`);
        // console.table(projects.map(p => ({ Key: p.key, Name: p.name })));

        const globalReport = [];

        for (const project of projects) {
            // SCHRITT 2: Issue-basierte Smells holen (Dead Code, Layer Violation, etc.)
            // Gruppierung nach Rules per Facets
            const issuesUrl = `${SONAR_URL}/api/issues/search?componentKeys=${project.key}&rules=${ALL_RULES}&ps=1&facets=rules`;
            const issuesResp = await fetch(issuesUrl, { headers: AUTH_HEADER });
            const issuesData = await issuesResp.json();
            //console.log(issuesResp);

            // Mapping der Issue-Counts
            const ruleCounts = {};
            if (issuesData.facets) {
                const rulesFacet = issuesData.facets.find(f => f.property === 'rules');
                if (rulesFacet) {
                    rulesFacet.values.forEach(v => {
                        ruleCounts[v.val] = v.count;
                    });
                }
            }

            const smellReport = { Project: project.name };
            
            // Kategorien auswerten und summieren
            for (const [category, rules] of Object.entries(SMELL_DEFINITIONS)) {
                let count = 0;
                rules.forEach(r => count += (ruleCounts[r] || 0));
                smellReport[category] = count;
            }

            // ---------------------------------------------------------
            // SCHRITT 3: Anemic Entities Heuristik (Verbesserte Version)
            // ---------------------------------------------------------
            
            // KONFIGURATION FÜR DIESEN SCHRITT:
            const NUR_IM_DOMAIN_ORDNER = true; // Setze auf true, um Pfad-Filter zu aktivieren
            
            // Wir erhöhen ps=500 (Maximum), damit wir möglichst viele Dateien erwischen
            const metricsUrl = `${SONAR_URL}/api/measures/component_tree?component=${project.key}&metricKeys=functions,cognitive_complexity,ncloc&qualifiers=FIL&ps=500`;
            const metricsResp = await fetch(metricsUrl, { headers: AUTH_HEADER });
            const metricsData = await metricsResp.json();

            const anemicCandidates = (metricsData.components || []).map(file => {
                const getVal = (key) => {
                    const m = file.measures.find(x => x.metric === key);
                    return m ? Number(m.value) : 0;
                };
                return {
                    Datei: file.name,
                    Pfad: file.path || file.key, // Pfad für den Filter sichern
                    Methoden: getVal('functions'),
                    Komplexitaet: getVal('cognitive_complexity'),
                    Zeilen: getVal('ncloc')
                };
            })
            .filter(row => {
                // REGEL 1: Komplexität <= 1 UND Methoden >= 1 (statt > 1)
                const isAnemic = row.Komplexitaet <= 1 && row.Methoden >= 1;
                
                if (!isAnemic) return false;

                // REGEL 2 (Optional): Ordner muss "domain" enthalten
                if (NUR_IM_DOMAIN_ORDNER) {
                    // Prüfen ob "domain" im Pfad vorkommt (Case Insensitive)
                    return (row.Pfad || "").toLowerCase().includes('domain');
                }

                return true;
            });

            smellReport['Anemic Entity (Heuristic)'] = anemicCandidates.length;

            // SCHRITT 4: Duplication Metrics (CPD) - für Blöcke am nächsten an der Art und Weise wie in der manuelle Analyse gezählt wurde
            const dupUrl = `${SONAR_URL}/api/measures/component?component=${project.key}&metricKeys=duplicated_blocks`;
            const dupResp = await fetch(dupUrl, { headers: AUTH_HEADER });
            const dupData = await dupResp.json();
            
            const dupVal = dupData.component.measures.find(m => m.metric === 'duplicated_blocks');
            
            // Ausgabe ist jetzt eine absolute Zahl, kein Prozentwert
            smellReport['Duplication (Lines)'] = dupVal ? Number(dupVal.value) : 0;

            globalReport.push(smellReport);
        }

        console.log("\nAbschlussbericht:");
        console.table(globalReport);

        if (globalReport.length > 0) {
            // 1. Header aus den Keys des ersten Objekts ziehen
            const headers = Object.keys(globalReport[0]);
            
            // 2. Datenreihen bauen
            const csvRows = globalReport.map(row => {
                return headers.map(fieldName => {
                    // Werte holen und sicherstellen, dass sie Strings sind
                    // Anführungszeichen escapen (falls welche im Namen sind) und Wert in Anführungszeichen setzen
                    const val = (row[fieldName] !== undefined && row[fieldName] !== null) ? String(row[fieldName]) : '';
                    return `"${val.replace(/"/g, '""')}"`;
                }).join(',');
            });

            // 3. Header und Daten zusammenfügen
            const csvContent = [headers.join(','), ...csvRows].join('\n');

            // 4. Datei schreiben
            fs.writeFileSync(CSV_FILENAME, csvContent);
            console.log(`\n✅ CSV-Datei erfolgreich gespeichert als: ${CSV_FILENAME}`);
        }

    } catch (error) {
        console.error("Ein Fehler ist aufgetreten:", error);
    }
}

runAnalysis();