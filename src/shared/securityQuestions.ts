// Security questions for password resets. The same 30 questions are in every
// portfolio app.

export const SECURITY_QUESTIONS: readonly string[] = [
  "What is your favorite movie?",
  "What is your favorite book?",
  "What is your favorite TV show?",
  "What is your favorite video game?",
  "What is your favorite board game?",
  "What is your favorite card game?",
  "What is your favorite tabletop RPG?",
  "What is your favorite fictional character?",
  "What is your favorite song?",
  "What is your favorite band or musician?",
  "What is your favorite food?",
  "What is your favorite dessert?",
  "What is your favorite ice cream flavor?",
  "What is your favorite pizza topping?",
  "What is your favorite drink?",
  "What is your favorite animal?",
  "What is your favorite color?",
  "What is your favorite season?",
  "What is your favorite holiday?",
  "What is your favorite sport to watch?",
  "What is your favorite number?",
  "What is your favorite word?",
  "What was the first video game you played?",
  "What was the first game console you owned?",
  "What was your dream job as a child?",
  "What would you name a pet dragon?",
  "What would you name a boat?",
  "What would you name a tavern?",
  "Where would you go on a dream vacation?",
  "Who is your favorite video game character?",
];

export const MAX_SECURITY_ANSWER = 100;

/** Answers match ignoring capitals and extra spaces. */
export function normalizeAnswer(answer: string): string {
  return answer.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}
