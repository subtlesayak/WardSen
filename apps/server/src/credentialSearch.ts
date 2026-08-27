import type { CredentialSummary, PaginationInput } from "@wardsen/core";

export function fuzzyFilterCredentials(
  items: CredentialSummary[],
  query: string,
  pagination: PaginationInput
): CredentialSummary[] {
  const queryTokens = searchTokens(query);
  if (queryTokens.length === 0) return paginate(items, pagination);

  return paginate(
    items
      .map((item, index) => ({ item, index, score: fuzzyCredentialScore(item, queryTokens) }))
      .filter((candidate): candidate is { item: CredentialSummary; index: number; score: number } => candidate.score !== undefined)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((candidate) => candidate.item),
    pagination
  );
}

function fuzzyCredentialScore(item: CredentialSummary, queryTokens: string[]): number | undefined {
  const candidateTokens = searchTokens([item.title, item.username, item.domain, item.uriPreview].filter(Boolean).join(" "));
  let score = 0;

  for (const queryToken of queryTokens) {
    const tokenScore = candidateTokens.reduce<number | undefined>((best, candidate) => {
      const current = fuzzyTokenScore(queryToken, candidate);
      return current === undefined || (best !== undefined && best >= current) ? best : current;
    }, undefined);
    if (tokenScore === undefined) return undefined;
    score += tokenScore;
  }

  return score;
}

function fuzzyTokenScore(query: string, candidate: string): number | undefined {
  if (candidate === query) return 1000;
  if (candidate.startsWith(query)) return 800 - candidate.length;
  if (candidate.includes(query)) return 600 - candidate.length;
  if (isSubsequence(query, candidate)) return 400 - candidate.length;

  const distance = levenshteinDistance(query, candidate);
  const allowedDistance = query.length <= 4 ? 1 : Math.floor(query.length * 0.3);
  return distance <= allowedDistance ? 200 - distance * 10 - candidate.length : undefined;
}

function searchTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function isSubsequence(query: string, candidate: string): boolean {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

function levenshteinDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function paginate<T>(items: T[], pagination: PaginationInput): T[] {
  const start = (Math.max(1, pagination.page) - 1) * pagination.pageSize;
  return items.slice(start, start + pagination.pageSize);
}
