// SQEM-676 — routine runs only. The SAME handler as chat-message, deployed under its own name, because Supabase
// gives each function its own workers: in a load test, routine runs next to live chats in one function cost live
// answers whenever a worker was killed for CPU time. Under this name a kill under
// routine load can never take a person's live chat with it, and vice versa.
//
// The handler refuses anything here that is not a routine run (dispatch secret or service key + signed ticket).
import '../chat-message/index.ts';
