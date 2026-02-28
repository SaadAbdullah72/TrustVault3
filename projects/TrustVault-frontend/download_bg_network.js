import fs from 'fs';
import https from 'https';

const file = fs.createWriteStream("src/assets/bg-network.jpg");
// High-tech blockchain network connection image
const url = "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?q=80&w=2832&auto=format&fit=crop";
const request = https.get(url, function (response) {
    response.pipe(file);
    file.on('finish', () => {
        file.close();
        console.log("Download completed!");
    });
});
