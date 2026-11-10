// Relevance of a job's places, shared by the list (routes/maps.ts) and the search itself
// (mapsJobRunner.ts), so both judge a place the same way.
import type { MapsJob } from "./mapsStore.js";
import { termSynonyms } from "./translateTerms.js";
import { isSearchableExpansion, placeRelevance, type PlaceRelevance } from "./searchProfile.js";

export interface RelevanceTerms {
  userTerms: string[];
  autoTerms: string[];
  synonyms: string[];
}

/** Terms typed by the user (with their translations), and the Google categories the job added. */
export function relevanceTerms(job: Pick<MapsJob, "config" | "cells">): RelevanceTerms {
  // The terms are read from the cells: each one carries the term it searched (typed or
  // translated). The job's name is not a term: a search named "Lyon arcades" made every place
  // with "Lyon" in its name a match (CrossFit Lyon, Lyon Floorball Club…).
  const userTerms = new Set<string>([job.config.searchTerm]);
  const autoTerms = new Set<string>();
  let cellsHaveTerms = false;
  for (const cell of job.cells) {
    if (!cell.searchTerm) continue;
    cellsHaveTerms = true;
    (cell.autoTerm ? autoTerms : userTerms).add(cell.searchTerm);
  }
  // Very old jobs have no term per cell: their terms are only in the name ("arcade, bowling").
  if (!cellsHaveTerms) for (const term of (job.config.label ?? "").split(",")) userTerms.add(term);
  const synonyms = new Set([...userTerms].flatMap((term) => termSynonyms(term)));
  return {
    userTerms: [...userTerms].map((t) => t.trim()).filter(Boolean),
    // An extra term now excluded ("playground", learned by a Tel Aviv search) no longer makes its
    // places relevant: they are judged on the terms typed.
    autoTerms: [...autoTerms].filter((a) => [...userTerms].some((t) => isSearchableExpansion(t, a))),
    synonyms: [...synonyms].filter((s) => !userTerms.has(s)),
  };
}

export function relevanceOf(place: { name: string; category?: string | null }, terms: RelevanceTerms): PlaceRelevance {
  return placeRelevance(place, terms.userTerms, terms.autoTerms, terms.synonyms);
}
