const AUTH_TOKEN = 'squ_fc122f630ab89ca62f31ab34641d4f6b5fac9d62'; // Dein Token
const AUTH_HEADER = { 'Authorization': 'Basic ' + Buffer.from(AUTH_TOKEN + ':').toString('base64') };

fetch('http://localhost:9000/api/users/current', { headers: AUTH_HEADER })
    .then(r => r.json())
    .then(user => {
        console.log("Token gehört User:", user.login, "| Name:", user.name);
        console.log("Gehört zu Gruppen:", user.groups);
    })
    .catch(e => console.error(e));