import fs from 'fs';
import https from 'https';

const file = fs.createWriteStream("src/assets/bg-navy.jpg");
// Deep Navy Blue Blockchain / Abstract Tech Image
// ID: photo-1639322537504-6427a16b0a28 (Deep Blue Cubes/Blockchain vibe)
const url = "https://images.unsplash.com/photo-1639322537504-6427a16b0a28?q=80&w=2560&auto=format&fit=crop";

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
