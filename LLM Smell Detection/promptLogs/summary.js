// Ai generated

const fs = require('fs');
const path = require('path');

// KONFIGURATION
// Den Pfad zu deinem Hauptordner hier anpassen ('.' ist der aktuelle Ordner)
const START_DIR = './withLines2'; 
const OUTPUT_FILE = './withLines_zusammenfassung2.txt';

// Hauptfunktion
async function main() {
    console.log(`⚓ Starte Suche in: ${START_DIR}`);
    
    // Lösche alte Zusammenfassungs-Datei, falls vorhanden, um sauber zu starten
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.unlinkSync(OUTPUT_FILE);
    }

    try {
        processDirectory(START_DIR);
        console.log(`✅ Mission erfüllt, Captain! Die Daten liegen in: ${OUTPUT_FILE}`);
    } catch (err) {
        console.error('❌ Es gab ein Leck im Rumpf:', err);
    }
}

// Rekursive Funktion zum Durchsuchen der Ordner
function processDirectory(directory) {
    const files = fs.readdirSync(directory);

    for (const file of files) {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            // Wenn es ein Ordner ist, tauche tiefer (Rekursion)
            processDirectory(fullPath);
        } else if (file.endsWith('.txt')) {
            // Wenn es eine .txt Datei ist, verarbeite sie
            processFile(fullPath);
        }
    }
}

// Funktion zum Auslesen und Schreiben
function processFile(filePath) {
    // Inhalt lesen
    const content = fs.readFileSync(filePath, 'utf8');
    const delimiter = '[RESPONSE]:';

    // Prüfen, ob der Marker existiert
    if (content.includes(delimiter)) {
        // Alles NACH dem Marker nehmen
        const parts = content.split(delimiter);
        // parts[1] ist alles nach dem ersten Vorkommen. 
        // Wir trimmen es, um unnötige Leerzeichen am Anfang/Ende zu entfernen.
        const responseContent = parts.slice(1).join(delimiter).trim(); 

        if (responseContent) {
            // Ordnername extrahieren (nur der direkte Elternordner)
            // path.dirname gibt den Pfad (z.B. a/b/c), path.basename nimmt davon nur den letzten Teil (c)
            const parentFolder = path.basename(path.dirname(filePath));
            const fileName = path.basename(filePath);

            // Formatierung für die Zusammenfassung
            const entry = `
--------------------------------------------------
📂 Ordner: ${parentFolder}
📄 Datei:  ${fileName}
--------------------------------------------------
${responseContent}

`;
            // An die Zusammenfassungs-Datei anhängen
            fs.appendFileSync(OUTPUT_FILE, entry);
            console.log(`   ➜ Habe ${fileName} aus Ordner '${parentFolder}' verarbeitet.`);
        }
    }
}

main();