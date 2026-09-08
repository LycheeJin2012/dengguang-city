// The consolidated stylesheet is small; preserve strings, URLs, and calc whitespace.
import {copyFileSync} from 'node:fs';
copyFileSync(new URL('../css/style.css',import.meta.url),new URL('../css/style.min.css',import.meta.url));
