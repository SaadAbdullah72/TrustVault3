import fs from 'fs';
import https from 'https';

const file = fs.createWriteStream("src/assets/bg-neural.jpg");
// Deep cyber neural network / blockchain connections image
const url = "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=2560&auto=format&fit=crop";
const request = https.get(url, function (response) {
    response.pipe(file);
    file.on('finish', () => {
        file.close();
        console.log("Download completed!");
    });
});
