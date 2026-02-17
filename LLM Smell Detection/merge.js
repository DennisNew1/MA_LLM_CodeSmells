const fs = require('fs');

// --- 1. Daten laden (Hier Pfade anpassen) ---
// Wir simulieren das Laden der Dateien. 
// In der Realität würdest du fs.readFileSync('datei.json') nutzen.

const inputSonarQube = JSON.parse(fs.readFileSync("../AnalysisCode/sonar_smell.json", "UTF-8"));

const inputLLMs = JSON.parse(fs.readFileSync("lineLog.json", "UTF-8"));

// Kombiniere beide Ladungen
const allData = [...inputSonarQube, ...inputLLMs.logs];

// --- 2. Daten Zusammenführen (Merging) ---

// Struktur: mergedData[projekt][klasse][smellType][tool] = [lines]
const mergedData = {};
const allToolsSet = new Set(); // Um später alle Spalten für CSV zu kennen

allData.forEach(entry => {
    const project = entry.projektName;
    const tool = entry.llm;
    allToolsSet.add(tool);
    console.log(entry.projektName);
    console.log(entry)
    entry.codeSmells.forEach(smellObj => {
        const className = smellObj.class;

        // Gehe durch alle Keys (außer 'class')
        Object.keys(smellObj).forEach(key => {
            if (key === 'class') return;

            const smellType = key;
            const lines = smellObj[key];

            // Struktur initialisieren, falls noch nicht vorhanden
            if (!mergedData[project]) mergedData[project] = {};
            if (!mergedData[project][className]) mergedData[project][className] = {};
            if (!mergedData[project][className][smellType]) mergedData[project][className][smellType] = {};

            // Daten speichern
            mergedData[project][className][smellType][tool] = lines;
        });
    });
});

// --- 3. JSON Output Generieren ---

const finalJsonOutput = Object.keys(mergedData).map(project => {
    const classesObj = mergedData[project];
    
    // CodeSmells Array aufbauen
    const codeSmells = Object.keys(classesObj).map(className => {
        const smellsObj = classesObj[className];
        
        // Das Objekt für eine Klasse erstellen
        const classEntry = { class: className };
        
        // Die Smell-Typen (duplication, deadCode etc.) hinzufügen
        Object.keys(smellsObj).forEach(smellType => {
            classEntry[smellType] = smellsObj[smellType];
        });
        
        return classEntry;
    });

    return {
        projektName: project,
        codeSmells: codeSmells
    };
});

// Speichern als JSON
fs.writeFileSync('merged_results.json', JSON.stringify(finalJsonOutput, null, 2));
console.log("Aye! JSON 'merged_results.json' liegt im Hafen.");

// --- 4. CSV Output Generieren ---

// Tools sortieren für konsistente Spaltenreihenfolge
const sortedTools = Array.from(allToolsSet).sort();

// CSV Header
const header = ["Projekt", "Klasse", "Smell", ...sortedTools];
const csvRows = [];

// Header hinzufügen (Semikolon-getrennt für Excel in DE oft besser)
csvRows.push(header.join(';'));

Object.keys(mergedData).forEach(project => {
    const classesObj = mergedData[project];
    
    Object.keys(classesObj).forEach(className => {
        const smellsObj = classesObj[className];
        
        Object.keys(smellsObj).forEach(smellType => {
            const toolResults = smellsObj[smellType];
            
            // Basis-Daten der Zeile
            const rowData = [project, className, smellType];
            
            // Für jedes Tool prüfen, ob Daten da sind
            sortedTools.forEach(tool => {
                const lines = toolResults[tool];
                if (lines && lines.length > 0) {
                    // Array zu String verbinden (z.B. "33-33, 44-44")
                    rowData.push(lines.join(', '));
                } else {
                    rowData.push(""); // Leere Zelle
                }
            });
            
            csvRows.push(rowData.join(';'));
        });
    });
});

// Speichern als CSV
fs.writeFileSync('merged_results.csv', csvRows.join('\n'));
console.log("Aye! CSV 'merged_results.csv' ist ebenfalls verladen.");