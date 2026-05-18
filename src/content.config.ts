import { defineCollection } from 'astro:content';
import { casesLoader, libLoader, overviewLoader } from './lib/cases-loader';

const cases = defineCollection({ loader: casesLoader });
const libFiles = defineCollection({ loader: libLoader });
const overview = defineCollection({ loader: overviewLoader });

export const collections = { cases, libFiles, overview };
