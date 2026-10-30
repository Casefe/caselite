// Deliberately invalid renderer code: the architecture check must reject it.
import { readFile } from 'node:fs/promises';

void readFile;
