

// AI generated
const TOKEN = 'squ_fc122f630ab89ca62f31ab34641d4f6b5fac9d62';
const PROJECT = 'st2_19'; 
const BASE_URL = 'http://localhost:9000';

const auth = { 'Authorization': 'Basic ' + Buffer.from(TOKEN + ':').toString('base64') };

async function debugCall() {
    console.log(`🔎 Untersuche Projekt: ${PROJECT}`);

    // TEST 1: Mit explizitem Qualifier (Nur Dateien)
    const url1 = `${BASE_URL}/api/measures/component_tree?component=${PROJECT}&metricKeys=ncloc&qualifiers=FIL&ps=1`;
    
    try {
        console.log("Versuch 1 (Mit qualifier=FIL)...");
        const r1 = await fetch(url1, { headers: auth });
        console.log(`Status: ${r1.status} ${r1.statusText}`);
        if(r1.status === 403) console.log("❌ Immer noch Forbidden");
        else console.log("✅ Erfolg!");
    } catch(e) { console.error(e); }

    // TEST 2: Alternative Route über components/tree (ohne Metriken, nur Struktur)
    // Das prüft, ob du überhaupt die Dateiliste sehen darfst
    const url2 = `${BASE_URL}/api/components/tree?component=${PROJECT}&qualifiers=FIL&ps=1`;
    
    try {
        console.log("\nVersuch 2 (Nur Struktur / components/tree)...");
        const r2 = await fetch(url2, { headers: auth });
        console.log(`Status: ${r2.status} ${r2.statusText}`);
        if (r2.status === 200) {
            console.log("✅ Dateiliste ist sichtbar! Das Problem liegt bei den Metriken.");
        } else {
            console.log("❌ Auch Dateiliste ist verboten (Source Code Permission fehlt).");
        }
    } catch(e) { console.error(e); }
}

debugCall();