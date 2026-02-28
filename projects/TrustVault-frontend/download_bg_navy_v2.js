import fs from 'fs';
import https from 'https';

const file = fs.createWriteStream("src/assets/bg-navy.jpg");
// High-Quality Navy Blue Abstract Blockchain Network
const url = "https://images.unsplash.com/photo-1614064641938-3bbee52942c7?q=80&w=2560&auto=format&fit=crop";

https.get(url, function (response) {
    if (response.statusCode !== 200) {
        console.error(`Request Failed. Status Code: ${response.statusCode}`);
        response.resume();
        process.exit(1);
        return;
    }
    response.pipe(file);
    file.on('finish', () => {
        file.close();
        console.log("Download completed!");
    });
}).on('error', (e) => {
    console.error(`Got error: ${e.message}`);
    process.exit(1);
});
