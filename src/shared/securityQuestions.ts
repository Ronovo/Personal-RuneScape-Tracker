// Security questions for password resets. The same 30 questions are in every
// portfolio app.

export const SECURITY_QUESTIONS: readonly string[] = [
  "What is your mother's maiden name?",
  "What was the name of your first pet?",
  "In what city were you born?",
  "What was the make and model of your first car?",
  "What was the name of your elementary school?",
  "What was the name of your childhood best friend?",
  "Who was your favorite teacher?",
  "What street did you grow up on?",
  "What is your father's middle name?",
  "What was your childhood nickname?",
  "In what city did your parents meet?",
  "What was the first concert you went to?",
  "What was the name of your first employer?",
  "In what hospital were you born?",
  "What was your favorite food as a child?",
  "What was the first video game you played?",
  "What is your oldest sibling's middle name?",
  "What was the name of your first stuffed animal?",
  "What was your high school mascot?",
  "In what city or town was your first job?",
  "What was the last name of your third grade teacher?",
  "What is your maternal grandmother's first name?",
  "What was your dream job as a child?",
  "What was your favorite book as a child?",
  "What is your favorite movie?",
  "Where did you go on your first vacation?",
  "What was the name of your first roommate?",
  "What was the first album you bought?",
  "What is your paternal grandfather's first name?",
  "What sport did you play most as a child?",
];

export const MAX_SECURITY_ANSWER = 100;

/** Answers match ignoring capitals and extra spaces. */
export function normalizeAnswer(answer: string): string {
  return answer.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}
