-- ============================================================
-- Seed: 60 published library templates (10 per category)
-- Categories: General, Marketing, Engineering, Business, Writing, Data & Research
-- ============================================================

INSERT INTO public.library_templates (title, description, category, tags, variables, steps, created_by, usage_count, published) VALUES

-- ══════════════════════════════════════════════════════════════
-- GENERAL (10)
-- ══════════════════════════════════════════════════════════════

(
  'Document Summariser',
  'Condenses any document into a clear, structured summary.',
  'General',
  ARRAY['summary', 'documents', 'productivity'],
  '[
    {"id":"v1","name":"document","label":"Document text","type":"textarea"},
    {"id":"v2","name":"length","label":"Summary length","type":"select","options":["brief (3-5 sentences)","standard (1-2 paragraphs)","detailed (3-4 paragraphs)"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Summarise","model":"gemini-2.5-flash","temperature":0.3,"content":"Summarise the following document into a {{length}} summary. Preserve key facts, decisions, and conclusions. Use plain language — no jargon unless it appears in the source.\n\nDocument:\n{{document}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Meeting Notes Cleaner',
  'Transforms raw meeting notes into a clean, structured record.',
  'General',
  ARRAY['meetings', 'notes', 'productivity'],
  '[
    {"id":"v1","name":"raw_notes","label":"Raw meeting notes","type":"textarea"},
    {"id":"v2","name":"attendees","label":"Attendees (comma-separated)","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Clean notes","model":"gemini-2.5-flash","temperature":0.2,"content":"Clean and structure the following meeting notes. Output format:\n\n**Attendees:** {{attendees}}\n\n**Summary** (2-3 sentences)\n\n**Key Discussion Points** (bullet list)\n\n**Decisions Made** (bullet list)\n\n**Action Items** (each with owner and deadline if mentioned)\n\nRaw notes:\n{{raw_notes}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Action Items Extractor',
  'Pulls every action item out of a block of text and formats them clearly.',
  'General',
  ARRAY['productivity', 'meetings', 'tasks'],
  '[
    {"id":"v1","name":"text","label":"Text to analyse","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Extract actions","model":"gemini-2.5-flash","temperature":0.1,"content":"Extract every action item from the text below. For each action item output:\n- Task description\n- Assigned to (if mentioned, otherwise \"Unassigned\")\n- Deadline (if mentioned, otherwise \"No deadline stated\")\n\nFormat as a numbered list. If no action items are found, say so explicitly.\n\nText:\n{{text}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Email Reply Drafter',
  'Drafts a professional email reply based on key points you want to make.',
  'General',
  ARRAY['email', 'communication', 'writing'],
  '[
    {"id":"v1","name":"original_email","label":"Original email","type":"textarea"},
    {"id":"v2","name":"tone","label":"Tone","type":"select","options":["formal","professional","friendly","brief and direct"]},
    {"id":"v3","name":"key_points","label":"Key points to address","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Draft reply","model":"gemini-2.5-flash","temperature":0.5,"content":"Draft a {{tone}} email reply to the following email. Address these key points:\n{{key_points}}\n\nDo not add a subject line. Start with an appropriate greeting. End with an appropriate sign-off. Be concise — say what needs to be said and nothing more.\n\nOriginal email:\n{{original_email}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Explain Simply',
  'Explains any complex topic in plain language for a specific audience.',
  'General',
  ARRAY['education', 'communication', 'simplification'],
  '[
    {"id":"v1","name":"topic","label":"Topic to explain","type":"text"},
    {"id":"v2","name":"audience","label":"Target audience","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Explain","model":"gemini-2.5-flash","temperature":0.5,"content":"Explain {{topic}} in plain language for {{audience}}. Avoid jargon. Use an analogy if it helps. Keep it concise — no longer than 200 words unless the topic genuinely requires more. End with the one key takeaway the reader should remember."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Text Proofreader',
  'Corrects grammar, spelling, punctuation, and clarity issues in any text.',
  'General',
  ARRAY['writing', 'editing', 'grammar'],
  '[
    {"id":"v1","name":"text","label":"Text to proofread","type":"textarea"},
    {"id":"v2","name":"formality","label":"Formality level","type":"select","options":["formal","professional","casual"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Proofread","model":"gemini-2.5-flash","temperature":0.1,"content":"Proofread the following text. Fix all grammar, spelling, and punctuation errors. Improve clarity and flow where needed, but preserve the author''s voice and intent. Match a {{formality}} register. Return the corrected text followed by a brief bullet list of the main changes made.\n\nText:\n{{text}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Q&A Generator',
  'Generates quiz or FAQ questions and answers from any source text.',
  'General',
  ARRAY['education', 'training', 'content'],
  '[
    {"id":"v1","name":"source_text","label":"Source text","type":"textarea"},
    {"id":"v2","name":"num_questions","label":"Number of questions","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Generate Q&As","model":"gemini-2.5-flash","temperature":0.4,"content":"Generate {{num_questions}} question-and-answer pairs based on the following text. Questions should test comprehension of key concepts, facts, and implications. Each answer should be 1-3 sentences. Format as a numbered list with Q: and A: labels.\n\nSource text:\n{{source_text}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Compare Two Options',
  'Produces a structured, balanced comparison of two options against defined criteria.',
  'General',
  ARRAY['decision-making', 'analysis', 'comparison'],
  '[
    {"id":"v1","name":"option_a","label":"Option A","type":"textarea"},
    {"id":"v2","name":"option_b","label":"Option B","type":"textarea"},
    {"id":"v3","name":"criteria","label":"Evaluation criteria (comma-separated)","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Compare","model":"gemini-2.5-flash","temperature":0.3,"content":"Compare the following two options across these criteria: {{criteria}}.\n\nOption A:\n{{option_a}}\n\nOption B:\n{{option_b}}\n\nStructure your response as:\n1. A comparison table (criteria vs. Option A / Option B)\n2. Key strengths and weaknesses of each\n3. A clear recommendation with reasoning"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Translate & Localise',
  'Translates text and adapts it for a specific market and culture.',
  'General',
  ARRAY['translation', 'localisation', 'international'],
  '[
    {"id":"v1","name":"text","label":"Text to translate","type":"textarea"},
    {"id":"v2","name":"target_language","label":"Target language","type":"text"},
    {"id":"v3","name":"target_market","label":"Target market / region","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Translate & localise","model":"gemini-2.5-flash","temperature":0.3,"content":"Translate the following text into {{target_language}} for a {{target_market}} audience. Do not just translate word-for-word — adapt idioms, cultural references, tone, and units of measurement where appropriate so the result reads naturally for a local reader. Note any localisation decisions you made.\n\nText:\n{{text}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Bullet Points to Paragraphs',
  'Converts bullet point notes into flowing, readable prose.',
  'General',
  ARRAY['writing', 'editing', 'content'],
  '[
    {"id":"v1","name":"bullet_points","label":"Bullet points","type":"textarea"},
    {"id":"v2","name":"tone","label":"Tone","type":"select","options":["formal","professional","conversational"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Convert to prose","model":"gemini-2.5-flash","temperature":0.5,"content":"Convert the following bullet points into well-structured, flowing paragraphs with a {{tone}} tone. Preserve all information. Connect ideas logically. Do not add facts that are not in the source material.\n\nBullet points:\n{{bullet_points}}"}
  ]'::jsonb,
  NULL, 0, true
),

-- ══════════════════════════════════════════════════════════════
-- MARKETING (10)
-- ══════════════════════════════════════════════════════════════

(
  'Product Description Writer',
  'Writes compelling product descriptions that convert browsers into buyers.',
  'Marketing',
  ARRAY['ecommerce', 'copywriting', 'product'],
  '[
    {"id":"v1","name":"product_name","label":"Product name","type":"text"},
    {"id":"v2","name":"key_features","label":"Key features / specs","type":"textarea"},
    {"id":"v3","name":"target_customer","label":"Target customer","type":"text"},
    {"id":"v4","name":"tone","label":"Brand tone","type":"select","options":["premium and sophisticated","friendly and approachable","bold and energetic","minimal and technical"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write description","model":"gemini-2.5-flash","temperature":0.7,"content":"Write a compelling product description for {{product_name}}. Target customer: {{target_customer}}. Brand tone: {{tone}}.\n\nKey features:\n{{key_features}}\n\nStructure: opening hook (1 sentence), benefit-led body (2-3 sentences), key features as bullet points (3-5), closing call to action. Focus on benefits over features. Make the customer feel the product."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Social Media Campaign',
  'Creates a coordinated multi-platform social media campaign for a product or initiative.',
  'Marketing',
  ARRAY['social media', 'campaign', 'content'],
  '[
    {"id":"v1","name":"campaign_subject","label":"Campaign subject","type":"text"},
    {"id":"v2","name":"goal","label":"Campaign goal","type":"text"},
    {"id":"v3","name":"audience","label":"Target audience","type":"text"},
    {"id":"v4","name":"platforms","label":"Platforms (comma-separated)","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Campaign strategy","model":"gemini-2.5-flash","temperature":0.6,"content":"Create a social media campaign strategy for: {{campaign_subject}}\n\nGoal: {{goal}}\nTarget audience: {{audience}}\nPlatforms: {{platforms}}\n\nInclude:\n- Core campaign message and hook\n- Tone and visual direction guidance\n- 3-phase timeline (Awareness → Engagement → Conversion)\n- Key metrics to track"},
    {"id":"s2","title":"Post copy","model":"gemini-2.5-flash","temperature":0.7,"includePreviousResult":true,"content":"Based on the campaign strategy, write the actual post copy for each platform listed in {{platforms}}. For each platform write 3 posts (one per campaign phase). Include hashtags where appropriate. Label clearly by platform and phase."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Ad Copy Generator',
  'Generates high-converting ad copy variants for testing.',
  'Marketing',
  ARRAY['advertising', 'copywriting', 'PPC'],
  '[
    {"id":"v1","name":"product_or_service","label":"Product or service","type":"text"},
    {"id":"v2","name":"value_proposition","label":"Core value proposition","type":"text"},
    {"id":"v3","name":"target_audience","label":"Target audience","type":"text"},
    {"id":"v4","name":"ad_format","label":"Ad format","type":"select","options":["Google Search","Meta/Facebook","LinkedIn","Display banner"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Generate ad copy","model":"gemini-2.5-flash","temperature":0.8,"content":"Write 3 ad copy variants for {{ad_format}} ads for {{product_or_service}}.\n\nValue proposition: {{value_proposition}}\nTarget audience: {{target_audience}}\n\nFor each variant include headline(s), body copy, and CTA — sized appropriately for {{ad_format}}. Each variant should use a different angle (e.g. benefit-led, problem-solution, social proof). Label each variant clearly."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Landing Page Copy',
  'Writes full landing page copy structured for conversion.',
  'Marketing',
  ARRAY['landing page', 'copywriting', 'conversion'],
  '[
    {"id":"v1","name":"product_or_service","label":"Product or service","type":"text"},
    {"id":"v2","name":"primary_benefit","label":"Primary benefit","type":"text"},
    {"id":"v3","name":"target_audience","label":"Target audience","type":"text"},
    {"id":"v4","name":"objections","label":"Top 3 objections to address","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Page structure & messaging","model":"gemini-2.5-flash","temperature":0.5,"content":"Plan the messaging architecture for a landing page for {{product_or_service}}.\n\nPrimary benefit: {{primary_benefit}}\nTarget audience: {{target_audience}}\nObjections to address: {{objections}}\n\nOutput: Hero message, value propositions (3-5), social proof strategy, objection-handling section plan, CTA strategy."},
    {"id":"s2","title":"Full copy","model":"gemini-2.5-flash","temperature":0.7,"includePreviousResult":true,"content":"Write the full landing page copy based on the messaging plan. Include: hero headline + subheadline, value prop section, features/benefits section, objection-handling section, FAQ (3-5 questions), and 2 CTA variants. Write for a {{target_audience}} audience."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Email Newsletter',
  'Writes an engaging email newsletter for your subscribers.',
  'Marketing',
  ARRAY['email', 'newsletter', 'content marketing'],
  '[
    {"id":"v1","name":"brand_name","label":"Brand name","type":"text"},
    {"id":"v2","name":"newsletter_topic","label":"Newsletter topic / theme","type":"text"},
    {"id":"v3","name":"key_content","label":"Key content points to include","type":"textarea"},
    {"id":"v4","name":"cta","label":"Primary CTA","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write newsletter","model":"gemini-2.5-flash","temperature":0.6,"content":"Write an email newsletter for {{brand_name}} on the topic of {{newsletter_topic}}.\n\nContent to include:\n{{key_content}}\n\nPrimary CTA: {{cta}}\n\nStructure: subject line + preview text, opening hook (1-2 sentences), main body (3-4 paragraphs), featured section or callout box, CTA section, brief sign-off. Keep a conversational but professional tone. Aim for 350-500 words."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Customer Persona Builder',
  'Builds a detailed customer persona from product and audience information.',
  'Marketing',
  ARRAY['persona', 'research', 'strategy'],
  '[
    {"id":"v1","name":"product_or_service","label":"Product or service","type":"text"},
    {"id":"v2","name":"audience_signals","label":"What you know about your audience","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Build persona","model":"gemini-2.5-flash","temperature":0.5,"content":"Build a detailed customer persona for {{product_or_service}} based on the following audience signals:\n\n{{audience_signals}}\n\nPersona format:\n- Name and demographic snapshot\n- Job role and daily responsibilities\n- Goals and motivations\n- Pain points and frustrations\n- How they discover and evaluate solutions like yours\n- Key objections to purchase\n- Preferred channels and content types\n- One quote that captures their mindset\n\nBe specific and realistic — avoid vague generalities."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Press Release Writer',
  'Writes a professional press release for announcements, launches, or milestones.',
  'Marketing',
  ARRAY['PR', 'communications', 'announcements'],
  '[
    {"id":"v1","name":"company_name","label":"Company name","type":"text"},
    {"id":"v2","name":"announcement","label":"What are you announcing?","type":"textarea"},
    {"id":"v3","name":"quote_source","label":"Spokesperson name and title","type":"text"},
    {"id":"v4","name":"date_and_location","label":"Date and location","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write press release","model":"gemini-2.5-flash","temperature":0.4,"content":"Write a professional press release for {{company_name}}.\n\nAnnouncement:\n{{announcement}}\n\nDate and location: {{date_and_location}}\nSpokesperson: {{quote_source}}\n\nFollow standard press release structure: FOR IMMEDIATE RELEASE header, headline, subheadline, dateline + lead paragraph (who, what, when, where, why), 2-3 body paragraphs, fabricated but realistic spokesperson quote attributed to {{quote_source}}, boilerplate (About {{company_name}} — write a plausible one), media contact placeholder. Use AP style."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Brand Voice Audit',
  'Analyses existing content and defines your brand voice guidelines.',
  'Marketing',
  ARRAY['brand', 'voice', 'guidelines'],
  '[
    {"id":"v1","name":"content_samples","label":"3-5 samples of existing content","type":"textarea"},
    {"id":"v2","name":"brand_description","label":"How would you describe your brand?","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Audit and define voice","model":"gemini-2.5-flash","temperature":0.4,"content":"Analyse the following content samples and define a brand voice guide for a brand described as: {{brand_description}}\n\nContent samples:\n{{content_samples}}\n\nOutput:\n1. Current voice analysis (what the content communicates, tone patterns, recurring language)\n2. Gaps between current voice and desired brand description\n3. Brand voice definition: 4 voice attributes with a description, dos, and don''ts for each\n4. Example: rewrite one of the sample sentences to match the defined voice"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'SEO Meta Tags Generator',
  'Writes optimised title tags and meta descriptions for web pages.',
  'Marketing',
  ARRAY['SEO', 'meta tags', 'web'],
  '[
    {"id":"v1","name":"page_topic","label":"Page topic / content summary","type":"textarea"},
    {"id":"v2","name":"primary_keyword","label":"Primary keyword","type":"text"},
    {"id":"v3","name":"secondary_keywords","label":"Secondary keywords (comma-separated)","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Generate meta tags","model":"gemini-2.5-flash","temperature":0.4,"content":"Write SEO-optimised meta tags for a web page about:\n{{page_topic}}\n\nPrimary keyword: {{primary_keyword}}\nSecondary keywords: {{secondary_keywords}}\n\nProvide 3 variants of each:\n- Title tag (50-60 characters, include primary keyword near the start)\n- Meta description (150-160 characters, include primary keyword naturally, include a CTA)\n\nLabel each variant. After the variants, explain the strategic differences between them."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Content Calendar Generator',
  'Builds a month of content ideas mapped to themes and channels.',
  'Marketing',
  ARRAY['content', 'planning', 'calendar'],
  '[
    {"id":"v1","name":"brand_or_product","label":"Brand or product","type":"text"},
    {"id":"v2","name":"audience","label":"Target audience","type":"text"},
    {"id":"v3","name":"channels","label":"Channels to plan for","type":"text"},
    {"id":"v4","name":"month_theme","label":"Month theme or campaign focus","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Content pillars","model":"gemini-2.5-flash","temperature":0.5,"content":"Define 4-5 content pillars for {{brand_or_product}} targeting {{audience}}. For each pillar explain: what it covers, why it matters to the audience, and example content formats. The overall month theme is: {{month_theme}}."},
    {"id":"s2","title":"4-week calendar","model":"gemini-2.5-flash","temperature":0.6,"includePreviousResult":true,"content":"Using the content pillars, create a 4-week content calendar for {{channels}}. For each week, plan content across all channels with: content idea/title, content pillar, format, and brief content hook (1-2 sentences). Ensure variety in format and pillar across the month."}
  ]'::jsonb,
  NULL, 0, true
),

-- ══════════════════════════════════════════════════════════════
-- ENGINEERING (10)
-- ══════════════════════════════════════════════════════════════

(
  'Code Reviewer',
  'Reviews code for bugs, security issues, performance, and readability.',
  'Engineering',
  ARRAY['code review', 'quality', 'security'],
  '[
    {"id":"v1","name":"code","label":"Code to review","type":"textarea"},
    {"id":"v2","name":"language","label":"Language / framework","type":"text"},
    {"id":"v3","name":"context","label":"What this code does","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Review","model":"gemini-2.5-flash","temperature":0.2,"content":"Review the following {{language}} code. Context: {{context}}\n\nAnalyse for:\n1. **Bugs and logic errors** — anything that will or might break\n2. **Security vulnerabilities** — injection, auth bypass, data exposure, etc.\n3. **Performance issues** — inefficient algorithms, unnecessary operations, N+1 queries\n4. **Readability and maintainability** — naming, complexity, structure\n5. **Best practices** — idiomatic {{language}}, missing error handling, etc.\n\nFor each issue: severity (critical / major / minor), location, description, and recommended fix.\n\nCode:\n```\n{{code}}\n```"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Pull Request Description',
  'Generates a clear, structured PR description from a summary of changes.',
  'Engineering',
  ARRAY['git', 'PR', 'documentation'],
  '[
    {"id":"v1","name":"changes_summary","label":"Summary of changes made","type":"textarea"},
    {"id":"v2","name":"ticket_ref","label":"Ticket / issue reference","type":"text"},
    {"id":"v3","name":"testing_notes","label":"How this was tested","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write PR description","model":"gemini-2.5-flash","temperature":0.3,"content":"Write a professional pull request description based on the following:\n\nChanges made:\n{{changes_summary}}\n\nTicket reference: {{ticket_ref}}\n\nTesting:\n{{testing_notes}}\n\nFormat:\n## Summary\n(1-2 sentence overview)\n\n## Changes\n(bullet list of specific changes)\n\n## Why\n(motivation and context)\n\n## Testing\n(what was tested and how)\n\n## Checklist\n- [ ] Tests added/updated\n- [ ] No breaking changes (or breaking changes documented)\n- [ ] Docs updated if needed"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Unit Test Generator',
  'Generates comprehensive unit tests for a given function or module.',
  'Engineering',
  ARRAY['testing', 'unit tests', 'quality'],
  '[
    {"id":"v1","name":"code","label":"Function or module to test","type":"textarea"},
    {"id":"v2","name":"language","label":"Language / test framework","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Generate tests","model":"gemini-2.5-flash","temperature":0.2,"content":"Write comprehensive unit tests for the following {{language}} code. Use {{language}} conventions and best practices.\n\nCover:\n- Happy path (expected inputs and outputs)\n- Edge cases (empty, null, boundary values)\n- Error cases (invalid inputs, thrown errors)\n- Any side effects\n\nEach test should have a clear, descriptive name. Add a brief comment only where the test intent is non-obvious.\n\nCode:\n```\n{{code}}\n```"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Technical Documentation Writer',
  'Writes clear technical documentation for a function, API, or system.',
  'Engineering',
  ARRAY['documentation', 'technical writing', 'API'],
  '[
    {"id":"v1","name":"code_or_system","label":"Code, API, or system to document","type":"textarea"},
    {"id":"v2","name":"audience","label":"Target audience","type":"select","options":["internal developers","external API consumers","non-technical stakeholders"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write docs","model":"gemini-2.5-flash","temperature":0.3,"content":"Write technical documentation for the following code or system, targeting {{audience}}.\n\n{{code_or_system}}\n\nInclude as appropriate:\n- Overview / purpose\n- Parameters / inputs with types and descriptions\n- Return value\n- Exceptions / error conditions\n- Usage example(s)\n- Notes or caveats\n\nMatch the level of technical detail to a {{audience}} audience. Write in present tense, active voice."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'SQL Query Builder',
  'Writes optimised SQL queries from a plain-language description.',
  'Engineering',
  ARRAY['SQL', 'database', 'queries'],
  '[
    {"id":"v1","name":"schema","label":"Relevant table schemas (CREATE TABLE or description)","type":"textarea"},
    {"id":"v2","name":"requirement","label":"What the query should return","type":"textarea"},
    {"id":"v3","name":"dialect","label":"SQL dialect","type":"select","options":["PostgreSQL","MySQL","SQLite","SQL Server","BigQuery"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Build query","model":"gemini-2.5-flash","temperature":0.1,"content":"Write a {{dialect}} SQL query that satisfies the following requirement:\n\n{{requirement}}\n\nSchema:\n{{schema}}\n\nProvide:\n1. The query (formatted and readable)\n2. Brief explanation of the approach\n3. Any indexes that would improve performance\n4. Edge cases or assumptions made"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Bug Root Cause Analyser',
  'Analyses a bug report to identify root cause and recommend fixes.',
  'Engineering',
  ARRAY['debugging', 'bug fix', 'analysis'],
  '[
    {"id":"v1","name":"bug_description","label":"Bug description and symptoms","type":"textarea"},
    {"id":"v2","name":"error_logs","label":"Error logs or stack trace","type":"textarea"},
    {"id":"v3","name":"relevant_code","label":"Relevant code (optional)","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Analyse bug","model":"gemini-2.5-flash","temperature":0.2,"content":"Analyse the following bug report and identify the root cause.\n\nBug description:\n{{bug_description}}\n\nError logs / stack trace:\n{{error_logs}}\n\nRelevant code:\n{{relevant_code}}\n\nProvide:\n1. **Root cause** — the specific reason this bug occurs\n2. **Contributing factors** — any conditions that make it worse or harder to spot\n3. **Recommended fix** — concrete change(s) to resolve it\n4. **Prevention** — how to prevent this class of bug in future (testing, linting, pattern changes)"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Architecture Decision Record',
  'Writes a structured ADR for a technical decision.',
  'Engineering',
  ARRAY['architecture', 'ADR', 'documentation'],
  '[
    {"id":"v1","name":"decision_title","label":"Decision title","type":"text"},
    {"id":"v2","name":"context","label":"Context and problem being solved","type":"textarea"},
    {"id":"v3","name":"options_considered","label":"Options considered","type":"textarea"},
    {"id":"v4","name":"chosen_option","label":"Chosen option and rationale","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write ADR","model":"gemini-2.5-flash","temperature":0.3,"content":"Write an Architecture Decision Record (ADR) for the following decision.\n\nTitle: {{decision_title}}\n\nContext:\n{{context}}\n\nOptions considered:\n{{options_considered}}\n\nDecision:\n{{chosen_option}}\n\nADR format:\n# {{decision_title}}\n**Status:** Accepted\n**Date:** [today]\n\n## Context\n## Decision\n## Options Considered (table: option / pros / cons)\n## Consequences (positive and negative)\n## Risks and Mitigations"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Code Refactorer',
  'Refactors code for clarity, maintainability, and best practices.',
  'Engineering',
  ARRAY['refactoring', 'code quality', 'clean code'],
  '[
    {"id":"v1","name":"code","label":"Code to refactor","type":"textarea"},
    {"id":"v2","name":"language","label":"Language / framework","type":"text"},
    {"id":"v3","name":"refactor_goals","label":"Refactoring goals","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Analyse and plan","model":"gemini-2.5-flash","temperature":0.2,"content":"Analyse the following {{language}} code and plan a refactoring strategy. Goals: {{refactor_goals}}\n\nIdentify:\n- Code smells and anti-patterns\n- Duplication\n- Complexity hotspots\n- Naming issues\n- Missing abstractions\n\nPrioritise the changes by impact. Do not write the refactored code yet.\n\nCode:\n```\n{{code}}\n```"},
    {"id":"s2","title":"Refactored code","model":"gemini-2.5-flash","temperature":0.2,"includePreviousResult":true,"content":"Apply the refactoring plan to produce the improved {{language}} code. Implement all planned changes. The output should be production-ready. After the code, provide a short changelog explaining the key changes made."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'API Endpoint Designer',
  'Designs a clean REST API endpoint specification from requirements.',
  'Engineering',
  ARRAY['API', 'REST', 'design'],
  '[
    {"id":"v1","name":"resource","label":"Resource or feature","type":"text"},
    {"id":"v2","name":"requirements","label":"Functional requirements","type":"textarea"},
    {"id":"v3","name":"constraints","label":"Constraints or conventions to follow","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Design endpoint","model":"gemini-2.5-flash","temperature":0.3,"content":"Design a REST API specification for {{resource}}.\n\nRequirements:\n{{requirements}}\n\nConstraints: {{constraints}}\n\nFor each endpoint provide:\n- Method and path\n- Description\n- Request parameters (path, query, body) with types and validation rules\n- Response schema (success and error cases) with HTTP status codes\n- Auth requirements\n- Rate limiting recommendations\n\nFollow REST best practices. Use OpenAPI-style formatting where helpful."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Incident Post-Mortem',
  'Generates a structured post-mortem report from an incident timeline.',
  'Engineering',
  ARRAY['incident', 'post-mortem', 'reliability'],
  '[
    {"id":"v1","name":"incident_summary","label":"Incident summary","type":"textarea"},
    {"id":"v2","name":"timeline","label":"Incident timeline","type":"textarea"},
    {"id":"v3","name":"impact","label":"Customer / business impact","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Root cause analysis","model":"gemini-2.5-flash","temperature":0.2,"content":"Analyse the following incident and perform a root cause analysis using the 5 Whys technique.\n\nIncident summary:\n{{incident_summary}}\n\nTimeline:\n{{timeline}}\n\nImpact: {{impact}}\n\nIdentify: immediate cause, contributing causes, root cause, and systemic factors."},
    {"id":"s2","title":"Post-mortem report","model":"gemini-2.5-flash","temperature":0.3,"includePreviousResult":true,"content":"Write a complete post-mortem report based on the incident details and root cause analysis.\n\nFormat:\n## Incident Summary\n## Impact\n## Timeline\n## Root Cause\n## Contributing Factors\n## What Went Well\n## What Went Wrong\n## Action Items (table: action / owner / priority / due date)\n## Lessons Learned\n\nBlameless tone throughout."}
  ]'::jsonb,
  NULL, 0, true
),

-- ══════════════════════════════════════════════════════════════
-- BUSINESS (10)
-- ══════════════════════════════════════════════════════════════

(
  'Job Description Writer',
  'Writes an inclusive, compelling job description that attracts the right candidates.',
  'Business',
  ARRAY['HR', 'recruitment', 'hiring'],
  '[
    {"id":"v1","name":"job_title","label":"Job title","type":"text"},
    {"id":"v2","name":"role_summary","label":"Role summary and key responsibilities","type":"textarea"},
    {"id":"v3","name":"requirements","label":"Required skills and experience","type":"textarea"},
    {"id":"v4","name":"company_description","label":"Company description","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write JD","model":"gemini-2.5-flash","temperature":0.5,"content":"Write a compelling, inclusive job description for a {{job_title}} role.\n\nCompany: {{company_description}}\n\nRole summary and responsibilities:\n{{role_summary}}\n\nRequirements:\n{{requirements}}\n\nInclude: role overview, responsibilities (6-8 bullets), requirements (must-have vs. nice-to-have), what we offer section, and a closing statement. Use inclusive language. Avoid jargon. Distinguish clearly between essential and preferred requirements."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'OKR Generator',
  'Generates well-structured Objectives and Key Results from strategic goals.',
  'Business',
  ARRAY['OKR', 'strategy', 'planning'],
  '[
    {"id":"v1","name":"team_or_company","label":"Team or company","type":"text"},
    {"id":"v2","name":"strategic_goals","label":"Strategic goals for the period","type":"textarea"},
    {"id":"v3","name":"timeframe","label":"Timeframe","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Generate OKRs","model":"gemini-2.5-flash","temperature":0.4,"content":"Generate OKRs for {{team_or_company}} for {{timeframe}}.\n\nStrategic goals:\n{{strategic_goals}}\n\nWrite 3-4 Objectives. For each Objective write 3-4 Key Results. Each Key Result must be:\n- Measurable (specific metric or binary outcome)\n- Ambitious but achievable\n- Outcome-focused (not activity-focused)\n\nAfter the OKRs, flag any goals that are too vague to measure and suggest how to sharpen them."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Business Case Builder',
  'Builds a structured business case for an investment or initiative.',
  'Business',
  ARRAY['business case', 'investment', 'strategy'],
  '[
    {"id":"v1","name":"initiative","label":"Initiative or investment description","type":"textarea"},
    {"id":"v2","name":"problem","label":"Problem or opportunity being addressed","type":"textarea"},
    {"id":"v3","name":"estimated_cost","label":"Estimated cost","type":"text"},
    {"id":"v4","name":"stakeholders","label":"Key stakeholders","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Structure and analysis","model":"gemini-2.5-flash","temperature":0.3,"content":"Analyse the following initiative and identify: key benefits (quantitative and qualitative), risks, alternatives considered, and success metrics.\n\nInitiative: {{initiative}}\nProblem / opportunity: {{problem}}\nEstimated cost: {{estimated_cost}}\nStakeholders: {{stakeholders}}"},
    {"id":"s2","title":"Full business case","model":"gemini-2.5-flash","temperature":0.4,"includePreviousResult":true,"content":"Write a complete business case document based on the analysis. Format:\n\n## Executive Summary\n## Problem Statement\n## Proposed Solution\n## Benefits and Value\n## Costs and Resources\n## Risks and Mitigations\n## Alternatives Considered\n## Recommendation\n## Next Steps\n\nKeep it concise and decision-focused. Lead with the recommendation."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Cold Email Sequence',
  'Writes a multi-touch cold outreach sequence for B2B sales.',
  'Business',
  ARRAY['sales', 'email', 'outreach'],
  '[
    {"id":"v1","name":"product_or_service","label":"Product or service","type":"text"},
    {"id":"v2","name":"target_role","label":"Target role / persona","type":"text"},
    {"id":"v3","name":"value_proposition","label":"Core value proposition","type":"text"},
    {"id":"v4","name":"num_emails","label":"Number of emails in sequence","type":"select","options":["3","4","5"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Sequence strategy","model":"gemini-2.5-flash","temperature":0.4,"content":"Plan a {{num_emails}}-email cold outreach sequence for {{product_or_service}} targeting {{target_role}}.\n\nValue proposition: {{value_proposition}}\n\nFor each email define: send timing, angle/hook, goal, and call to action. Vary angles across the sequence (problem-led, ROI-led, social proof, urgency, break-up)."},
    {"id":"s2","title":"Email copy","model":"gemini-2.5-flash","temperature":0.6,"includePreviousResult":true,"content":"Write the full copy for each email in the sequence. Each email should be under 150 words. Include subject line, preview text, and body. Keep it human — avoid corporate speak. Each email should stand alone but work as part of a sequence."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Performance Review Writer',
  'Writes a balanced, specific performance review for an employee.',
  'Business',
  ARRAY['HR', 'performance', 'feedback'],
  '[
    {"id":"v1","name":"employee_name","label":"Employee name and role","type":"text"},
    {"id":"v2","name":"achievements","label":"Key achievements and contributions","type":"textarea"},
    {"id":"v3","name":"areas_for_growth","label":"Areas for growth or development","type":"textarea"},
    {"id":"v4","name":"review_period","label":"Review period","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write review","model":"gemini-2.5-flash","temperature":0.4,"content":"Write a professional performance review for {{employee_name}} for the period {{review_period}}.\n\nAchievements:\n{{achievements}}\n\nAreas for growth:\n{{areas_for_growth}}\n\nStructure: opening assessment (overall performance summary), strengths section (specific examples), development areas section (constructive and forward-looking), goals for next period (2-3 clear objectives). Be specific — cite actual contributions. Avoid vague praise. Constructive feedback should focus on behaviour, not personality."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'SWOT Analysis',
  'Produces a thorough SWOT analysis with strategic recommendations.',
  'Business',
  ARRAY['strategy', 'SWOT', 'analysis'],
  '[
    {"id":"v1","name":"subject","label":"Company, product, or initiative to analyse","type":"text"},
    {"id":"v2","name":"context","label":"Relevant context (market, competitors, situation)","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"SWOT analysis","model":"gemini-2.5-flash","temperature":0.4,"content":"Perform a thorough SWOT analysis for {{subject}}.\n\nContext:\n{{context}}\n\nFor each quadrant (Strengths, Weaknesses, Opportunities, Threats) provide 4-6 specific, substantive points — not generic platitudes. After the four quadrants, add:\n- SO Strategies (use strengths to exploit opportunities)\n- ST Strategies (use strengths to mitigate threats)\n- WO Strategies (address weaknesses to exploit opportunities)\n- WT Strategies (minimise weaknesses and avoid threats)\n\nClose with a priority recommendation based on the analysis."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Meeting Agenda Generator',
  'Creates a focused, time-boxed meeting agenda.',
  'Business',
  ARRAY['meetings', 'productivity', 'planning'],
  '[
    {"id":"v1","name":"meeting_goal","label":"Meeting goal / desired outcome","type":"text"},
    {"id":"v2","name":"topics","label":"Topics to cover","type":"textarea"},
    {"id":"v3","name":"duration","label":"Meeting duration (minutes)","type":"text"},
    {"id":"v4","name":"attendees","label":"Attendees and their roles","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Build agenda","model":"gemini-2.5-flash","temperature":0.3,"content":"Create a focused meeting agenda for a {{duration}}-minute meeting.\n\nGoal / desired outcome: {{meeting_goal}}\nAttendees: {{attendees}}\n\nTopics:\n{{topics}}\n\nFormat each agenda item with: time allocation, item title, format (discussion / decision / update / brainstorm), and owner. Add a 5-minute buffer. Start with a 2-minute context setter. End with decisions & next steps. Pre-reading or pre-work required should be noted at the top."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Investor Update',
  'Writes a concise, credible monthly or quarterly investor update.',
  'Business',
  ARRAY['investor relations', 'startup', 'communications'],
  '[
    {"id":"v1","name":"company_name","label":"Company name","type":"text"},
    {"id":"v2","name":"period","label":"Update period","type":"text"},
    {"id":"v3","name":"highlights","label":"Key highlights and wins","type":"textarea"},
    {"id":"v4","name":"metrics","label":"Key metrics (revenue, growth, users, etc.)","type":"textarea"},
    {"id":"v5","name":"challenges","label":"Challenges and how you are addressing them","type":"textarea"},
    {"id":"v6","name":"asks","label":"What you need from investors","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write investor update","model":"gemini-2.5-flash","temperature":0.4,"content":"Write a concise investor update email for {{company_name}} covering {{period}}.\n\nHighlights: {{highlights}}\nMetrics: {{metrics}}\nChallenges: {{challenges}}\nAsks: {{asks}}\n\nFormat:\n- Subject line\n- TL;DR (3 bullets)\n- Highlights section\n- Key metrics (formatted clearly)\n- Challenges and mitigations\n- Focus for next period\n- Asks\n- Closing\n\nTone: direct, honest, confident. Investors appreciate brevity and candour over spin."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Contract Summary',
  'Summarises a contract''s key terms, obligations, and risks in plain language.',
  'Business',
  ARRAY['legal', 'contracts', 'risk'],
  '[
    {"id":"v1","name":"contract_text","label":"Contract text","type":"textarea"},
    {"id":"v2","name":"perspective","label":"Summarising from whose perspective","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Summarise contract","model":"gemini-2.5-flash","temperature":0.2,"content":"Summarise the following contract from the perspective of {{perspective}}. This is for informational purposes only — not legal advice.\n\nExtract and explain in plain language:\n1. **Parties and relationship** — who are the parties and what is the nature of the agreement\n2. **Key obligations** — what each party must do\n3. **Payment terms** — amounts, timing, penalties\n4. **Term and termination** — duration, notice periods, termination rights\n5. **Liability and indemnification** — caps, exclusions, indemnity obligations\n6. **IP and confidentiality** — ownership, NDA terms\n7. **Red flags or unusual clauses** — anything that warrants legal review\n\nContract:\n{{contract_text}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Business Proposal',
  'Writes a persuasive business proposal for a client or partner.',
  'Business',
  ARRAY['sales', 'proposal', 'client'],
  '[
    {"id":"v1","name":"client_name","label":"Client name","type":"text"},
    {"id":"v2","name":"client_problem","label":"Client problem or goal","type":"textarea"},
    {"id":"v3","name":"proposed_solution","label":"Your proposed solution","type":"textarea"},
    {"id":"v4","name":"your_company","label":"Your company name and brief","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Value proposition and structure","model":"gemini-2.5-flash","temperature":0.4,"content":"Define the value proposition and key messages for a business proposal to {{client_name}}.\n\nClient problem: {{client_problem}}\nProposed solution: {{proposed_solution}}\nYour company: {{your_company}}\n\nIdentify: core value proposition, key differentiators, expected ROI or outcomes for the client, and potential objections to pre-empt."},
    {"id":"s2","title":"Full proposal","model":"gemini-2.5-flash","temperature":0.5,"includePreviousResult":true,"content":"Write the full business proposal for {{client_name}} based on the value proposition and messaging. Format:\n\n## Executive Summary\n## Understanding Your Challenge\n## Our Proposed Solution\n## Approach and Timeline\n## Why {{your_company}}\n## Investment\n## Next Steps\n\nTone: confident and client-focused. Lead with their problem, not your product."}
  ]'::jsonb,
  NULL, 0, true
),

-- ══════════════════════════════════════════════════════════════
-- WRITING (10)
-- ══════════════════════════════════════════════════════════════

(
  'Blog Post Writer',
  'Writes a well-structured, engaging blog post optimised for readers and SEO.',
  'Writing',
  ARRAY['blog', 'content', 'SEO'],
  '[
    {"id":"v1","name":"topic","label":"Blog post topic","type":"text"},
    {"id":"v2","name":"audience","label":"Target audience","type":"text"},
    {"id":"v3","name":"keywords","label":"Target keywords (comma-separated)","type":"text"},
    {"id":"v4","name":"word_count","label":"Target word count","type":"select","options":["600-800 words","800-1200 words","1200-1800 words"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Outline","model":"gemini-2.5-flash","temperature":0.5,"content":"Create a detailed outline for a {{word_count}} blog post on ''{{topic}}'' for {{audience}}.\n\nTarget keywords: {{keywords}}\n\nInclude: working title (H1), hook approach, section headings (H2/H3), key points per section, CTA idea."},
    {"id":"s2","title":"Full post","model":"gemini-2.5-flash","temperature":0.7,"includePreviousResult":true,"content":"Write the full blog post based on the outline. Target length: {{word_count}}. Audience: {{audience}}. Naturally incorporate keywords: {{keywords}}.\n\nStart with a compelling hook. Use subheadings. Write for scanability. End with a clear takeaway and CTA. Do not use generic filler phrases like ''In today''s fast-paced world''."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Executive Summary Writer',
  'Writes a concise executive summary for reports, proposals, or research.',
  'Writing',
  ARRAY['executive summary', 'business writing', 'reports'],
  '[
    {"id":"v1","name":"document","label":"Full document or detailed notes","type":"textarea"},
    {"id":"v2","name":"audience","label":"Who will read this summary","type":"text"},
    {"id":"v3","name":"max_length","label":"Maximum length","type":"select","options":["half a page","one page","two pages"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write summary","model":"gemini-2.5-flash","temperature":0.3,"content":"Write an executive summary of the following document. Audience: {{audience}}. Maximum length: {{max_length}}.\n\nThe summary must cover: purpose and context, key findings or recommendations, evidence or rationale (brief), conclusions, and required actions or decisions.\n\nLead with the conclusion — executives read the first paragraph and skim the rest. Avoid jargon. Every sentence must add value.\n\nDocument:\n{{document}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Cover Letter Writer',
  'Writes a compelling, personalised cover letter for a job application.',
  'Writing',
  ARRAY['job application', 'cover letter', 'career'],
  '[
    {"id":"v1","name":"job_title","label":"Job title and company","type":"text"},
    {"id":"v2","name":"job_description","label":"Job description (key requirements)","type":"textarea"},
    {"id":"v3","name":"candidate_background","label":"Your relevant experience and skills","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write cover letter","model":"gemini-2.5-flash","temperature":0.6,"content":"Write a compelling cover letter for a {{job_title}} role.\n\nJob requirements:\n{{job_description}}\n\nCandidate background:\n{{candidate_background}}\n\nStructure: opening hook (why this role, not ''I am writing to apply''), 2 body paragraphs showing specific fit for the role, closing with confidence and a clear next step. Maximum 350 words. Make it sound like a real person wrote it."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'LinkedIn Post Writer',
  'Writes engaging LinkedIn posts that spark conversation and build authority.',
  'Writing',
  ARRAY['LinkedIn', 'social media', 'personal brand'],
  '[
    {"id":"v1","name":"topic_or_story","label":"Topic, story, or insight to share","type":"textarea"},
    {"id":"v2","name":"goal","label":"Goal of the post","type":"select","options":["thought leadership","share a lesson learned","announce news","spark debate","inspire action"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write post","model":"gemini-2.5-flash","temperature":0.7,"content":"Write a LinkedIn post that achieves the goal: {{goal}}.\n\nContent to draw from:\n{{topic_or_story}}\n\nLinkedIn post best practices:\n- Hook in the first line (no context-setting, no ''I''m excited to share'')\n- Short paragraphs (1-3 sentences each)\n- Personal and direct voice\n- Specific and concrete — avoid generic advice\n- End with a question or clear point of view\n- No more than 3 hashtags, at the end\n- Aim for 150-250 words"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Case Study Writer',
  'Writes a compelling customer case study from project details.',
  'Writing',
  ARRAY['case study', 'marketing', 'customer success'],
  '[
    {"id":"v1","name":"customer_name","label":"Customer name","type":"text"},
    {"id":"v2","name":"challenge","label":"Customer challenge or problem","type":"textarea"},
    {"id":"v3","name":"solution","label":"Solution implemented","type":"textarea"},
    {"id":"v4","name":"results","label":"Results and outcomes (with metrics)","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Story structure","model":"gemini-2.5-flash","temperature":0.4,"content":"Plan the narrative structure for a case study about {{customer_name}}. Identify: the most compelling angle, the emotional arc, the hero (customer vs. solution), and 3 key proof points to emphasise."},
    {"id":"s2","title":"Full case study","model":"gemini-2.5-flash","temperature":0.6,"includePreviousResult":true,"content":"Write the full case study using the narrative structure. Format:\n\n**Headline** (outcome-focused, specific)\n**Subheadline** (1 sentence)\n\n**The Challenge** (the situation before — specific pain, stakes)\n**The Solution** (what was implemented and why)\n**The Results** (lead with metrics, then qualitative impact)\n**A Quote** (realistic quote attributed to a {{customer_name}} representative)\n**Key Takeaway**\n\nTone: story-driven but credible. Specific beats vague. Aim for 400-600 words."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Thought Leadership Article',
  'Writes an original, opinionated thought leadership article for publication.',
  'Writing',
  ARRAY['thought leadership', 'publishing', 'personal brand'],
  '[
    {"id":"v1","name":"thesis","label":"Central thesis or argument","type":"text"},
    {"id":"v2","name":"audience","label":"Target audience and publication","type":"text"},
    {"id":"v3","name":"supporting_points","label":"Key supporting arguments or evidence","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Argument and structure","model":"gemini-2.5-flash","temperature":0.5,"content":"Develop and stress-test the following thesis for a thought leadership article targeting {{audience}}:\n\n''{{thesis}}''\n\nSupporting points:\n{{supporting_points}}\n\nIdentify: the strongest version of this argument, counterarguments to acknowledge, the most compelling evidence, and the ideal article structure."},
    {"id":"s2","title":"Full article","model":"gemini-2.5-flash","temperature":0.7,"includePreviousResult":true,"content":"Write the full thought leadership article (700-1000 words) based on the developed argument. For {{audience}}.\n\nStart with a provocative or surprising opening. Take a clear position — do not hedge. Use evidence and examples. Acknowledge the strongest counterargument and rebut it. End with a call to think or act differently. Write in a confident, authoritative voice."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Product Changelog Writer',
  'Turns raw release notes into a polished, user-facing changelog.',
  'Writing',
  ARRAY['product', 'changelog', 'release notes'],
  '[
    {"id":"v1","name":"version","label":"Version number","type":"text"},
    {"id":"v2","name":"raw_changes","label":"Raw changes and technical notes","type":"textarea"},
    {"id":"v3","name":"tone","label":"Tone","type":"select","options":["professional","friendly and casual","technical"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write changelog","model":"gemini-2.5-flash","temperature":0.4,"content":"Rewrite the following raw release notes as a polished, user-facing changelog entry for version {{version}}.\n\nTone: {{tone}}\n\nRaw changes:\n{{raw_changes}}\n\nGroup changes under: New, Improved, Fixed (only include sections with content). Write each item from the user''s perspective — what benefit they get, not what code changed. Exclude internal-only changes. Start with the most impactful changes."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Speech Writer',
  'Writes a compelling speech for presentations, events, or ceremonies.',
  'Writing',
  ARRAY['speech', 'presentation', 'public speaking'],
  '[
    {"id":"v1","name":"occasion","label":"Occasion and context","type":"text"},
    {"id":"v2","name":"speaker","label":"Who is delivering the speech","type":"text"},
    {"id":"v3","name":"key_messages","label":"Key messages or themes","type":"textarea"},
    {"id":"v4","name":"duration","label":"Approximate duration (minutes)","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Speech structure","model":"gemini-2.5-flash","temperature":0.5,"content":"Plan a {{duration}}-minute speech for {{speaker}} for {{occasion}}.\n\nKey messages:\n{{key_messages}}\n\nIdentify: opening hook, narrative arc, 3 main points with supporting stories or evidence, emotional peak moment, and closing."},
    {"id":"s2","title":"Full speech","model":"gemini-2.5-flash","temperature":0.7,"includePreviousResult":true,"content":"Write the full speech based on the structure. Duration: {{duration}} minutes (approximately {{duration}} × 130 words). Voice: {{speaker}}.\n\nOpen with the hook. Use storytelling. Make it feel personal and authentic. Vary sentence length for rhythm. Include a memorable closing line. Write for speaking, not reading — use natural spoken language."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'White Paper Outline',
  'Creates a detailed white paper outline with section summaries and argument flow.',
  'Writing',
  ARRAY['white paper', 'thought leadership', 'research'],
  '[
    {"id":"v1","name":"topic","label":"White paper topic","type":"text"},
    {"id":"v2","name":"audience","label":"Target audience","type":"text"},
    {"id":"v3","name":"core_argument","label":"Core argument or position","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Create outline","model":"gemini-2.5-flash","temperature":0.4,"content":"Create a detailed white paper outline on ''{{topic}}'' for {{audience}}.\n\nCore argument:\n{{core_argument}}\n\nFor each section include: section title, 3-5 sentence summary of content, key points to make, evidence or data needed, and how it advances the core argument. Include: Executive Summary, Introduction, 4-6 body sections, Conclusion, and Recommendations. Also suggest: ideal length, suggested visuals or data exhibits, and any case studies to include."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Personal Bio Writer',
  'Writes a compelling personal bio for profiles, websites, or speaking events.',
  'Writing',
  ARRAY['bio', 'personal brand', 'profile'],
  '[
    {"id":"v1","name":"name","label":"Your name","type":"text"},
    {"id":"v2","name":"role_and_background","label":"Current role and background","type":"textarea"},
    {"id":"v3","name":"achievements","label":"Key achievements","type":"textarea"},
    {"id":"v4","name":"purpose","label":"Where the bio will be used","type":"select","options":["LinkedIn profile","website About page","conference speaker bio","investor profile","press profile"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write bio","model":"gemini-2.5-flash","temperature":0.6,"content":"Write a compelling personal bio for {{name}} for use as a {{purpose}}.\n\nBackground:\n{{role_and_background}}\n\nAchievements:\n{{achievements}}\n\nWrite in third person. Lead with who they are and what makes them distinctive, not their job title. Include 1-2 specific achievements with numbers or outcomes. Match the length and tone to the {{purpose}} context. End with a human touch (interest, mission, or unique perspective). Avoid clichés like ''passionate about'' and ''results-driven''."}
  ]'::jsonb,
  NULL, 0, true
),

-- ══════════════════════════════════════════════════════════════
-- DATA & RESEARCH (10)
-- ══════════════════════════════════════════════════════════════

(
  'Research Paper Summariser',
  'Summarises an academic or research paper for a non-specialist audience.',
  'Data & Research',
  ARRAY['research', 'academia', 'summarisation'],
  '[
    {"id":"v1","name":"paper_text","label":"Paper abstract or full text","type":"textarea"},
    {"id":"v2","name":"audience","label":"Target audience","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Summarise paper","model":"gemini-2.5-flash","temperature":0.3,"content":"Summarise the following research paper for {{audience}}.\n\nStructure:\n- **What they studied** — research question and why it matters\n- **How they did it** — methodology in plain terms\n- **What they found** — key findings and data points\n- **What it means** — implications and significance\n- **Limitations** — what the study cannot tell us\n- **One key takeaway** — the single most important thing to remember\n\nAvoid jargon. Explain technical terms when used. Maximum 400 words.\n\nPaper:\n{{paper_text}}"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Customer Feedback Analyser',
  'Analyses customer feedback to identify themes, sentiment, and priority issues.',
  'Data & Research',
  ARRAY['customer feedback', 'sentiment', 'product'],
  '[
    {"id":"v1","name":"feedback_data","label":"Customer feedback (reviews, survey responses, etc.)","type":"textarea"},
    {"id":"v2","name":"product_or_service","label":"Product or service","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Theme extraction","model":"gemini-2.5-flash","temperature":0.2,"content":"Analyse the following customer feedback for {{product_or_service}}. Extract and categorise all recurring themes. For each theme note: frequency (how often it appears), sentiment (positive / negative / mixed), and representative quotes.\n\nFeedback:\n{{feedback_data}}"},
    {"id":"s2","title":"Insights and recommendations","model":"gemini-2.5-flash","temperature":0.3,"includePreviousResult":true,"content":"Based on the theme analysis, provide:\n1. **Overall sentiment** — net assessment of customer sentiment\n2. **Top 3 strengths** — what customers love most\n3. **Top 3 pain points** — most critical issues to fix\n4. **Quick wins** — changes that would improve sentiment fast\n5. **Strategic recommendations** — longer-term product or service changes\n6. **Priority matrix** — rank issues by impact × frequency"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Survey Results Interpreter',
  'Interprets survey results and produces clear findings and recommendations.',
  'Data & Research',
  ARRAY['survey', 'research', 'analysis'],
  '[
    {"id":"v1","name":"survey_results","label":"Survey results (raw data or summary)","type":"textarea"},
    {"id":"v2","name":"survey_goal","label":"What the survey was trying to find out","type":"text"},
    {"id":"v3","name":"respondents","label":"Who responded (number and profile)","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Interpret results","model":"gemini-2.5-flash","temperature":0.3,"content":"Interpret the following survey results. Survey goal: {{survey_goal}}. Respondents: {{respondents}}.\n\nResults:\n{{survey_results}}\n\nProvide:\n1. **Key findings** — most significant results with percentages/numbers\n2. **Patterns and correlations** — notable relationships in the data\n3. **Surprising or unexpected results** — results that deviate from expectations\n4. **Confidence caveats** — limitations of the sample or methodology\n5. **Conclusions** — what the data tells you about {{survey_goal}}\n6. **Recommended actions** — what to do based on the findings"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'KPI Narrative Writer',
  'Turns a set of KPI numbers into a clear management narrative.',
  'Data & Research',
  ARRAY['KPIs', 'reporting', 'management'],
  '[
    {"id":"v1","name":"kpi_data","label":"KPI data (metrics, values, period, targets)","type":"textarea"},
    {"id":"v2","name":"audience","label":"Audience for this report","type":"text"},
    {"id":"v3","name":"period","label":"Reporting period","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write KPI narrative","model":"gemini-2.5-flash","temperature":0.3,"content":"Write a management narrative for the following KPIs for {{period}}. Audience: {{audience}}.\n\nKPI data:\n{{kpi_data}}\n\nFormat:\n- **Executive summary** (3-4 sentences: overall performance, headline number, key signal)\n- **Highlights** — metrics beating target with brief explanation\n- **Concerns** — metrics missing target with root cause and corrective action\n- **Trends to watch** — early indicators for next period\n- **Bottom line** — one clear judgment on overall performance\n\nBe direct. Name the numbers. Don''t just describe — interpret."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Market Research Brief',
  'Writes a structured brief for commissioning or conducting market research.',
  'Data & Research',
  ARRAY['market research', 'strategy', 'planning'],
  '[
    {"id":"v1","name":"business_question","label":"Business question to answer","type":"text"},
    {"id":"v2","name":"context","label":"Business context and current knowledge","type":"textarea"},
    {"id":"v3","name":"decision","label":"What decision will this research inform?","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Write research brief","model":"gemini-2.5-flash","temperature":0.4,"content":"Write a market research brief for the following:\n\nBusiness question: {{business_question}}\nDecision to inform: {{decision}}\nContext: {{context}}\n\nBrief format:\n1. Background and context\n2. Research objectives (primary and secondary)\n3. Key research questions (10-15 specific questions)\n4. Methodology recommendations (qual/quant/desk research mix)\n5. Target respondents / data sources\n6. Deliverables required\n7. Hypotheses to test\n8. Scope and exclusions\n9. Success criteria (how will we know the research was useful?)"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Trend Analyser',
  'Analyses trends in a market, industry, or data set and extracts strategic implications.',
  'Data & Research',
  ARRAY['trends', 'strategy', 'foresight'],
  '[
    {"id":"v1","name":"domain","label":"Market, industry, or topic","type":"text"},
    {"id":"v2","name":"trend_data","label":"Trend data, signals, or observations","type":"textarea"},
    {"id":"v3","name":"time_horizon","label":"Time horizon","type":"select","options":["next 12 months","next 2-3 years","next 5+ years"]}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Analyse trends","model":"gemini-2.5-flash","temperature":0.5,"content":"Analyse the following trends in {{domain}} over a {{time_horizon}} time horizon.\n\nTrend data and signals:\n{{trend_data}}\n\nFor each significant trend:\n- Trend description and evidence\n- Drivers (why is this happening?)\n- Trajectory (is it accelerating, stable, peaking?)\n- Strategic implications for incumbents\n- Strategic implications for new entrants\n- Risks if ignored\n\nClose with: the 3 most important things to act on in the {{time_horizon}} horizon."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Competitive Intelligence Report',
  'Produces a structured competitive analysis from gathered intelligence.',
  'Data & Research',
  ARRAY['competitive intelligence', 'strategy', 'analysis'],
  '[
    {"id":"v1","name":"your_company","label":"Your company and product","type":"text"},
    {"id":"v2","name":"competitors","label":"Competitors to analyse","type":"textarea"},
    {"id":"v3","name":"intelligence","label":"Intelligence gathered (features, pricing, positioning, reviews)","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Competitive mapping","model":"gemini-2.5-flash","temperature":0.3,"content":"Analyse the competitive landscape for {{your_company}} based on the following intelligence.\n\nCompetitors:\n{{competitors}}\n\nIntelligence:\n{{intelligence}}\n\nMap each competitor on: positioning, target segment, key strengths, key weaknesses, pricing strategy, and differentiators."},
    {"id":"s2","title":"Strategic report","model":"gemini-2.5-flash","temperature":0.4,"includePreviousResult":true,"content":"Write a competitive intelligence report for {{your_company}} based on the competitive mapping.\n\nInclude:\n1. Competitive landscape overview\n2. Competitor profiles (one per competitor)\n3. Competitive comparison matrix\n4. Where {{your_company}} wins\n5. Where {{your_company}} is vulnerable\n6. White space opportunities\n7. Strategic recommendations (3-5 actions)"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Data Anomaly Explainer',
  'Investigates and explains unexpected patterns or anomalies in data.',
  'Data & Research',
  ARRAY['data analysis', 'anomalies', 'debugging'],
  '[
    {"id":"v1","name":"data_description","label":"What the data represents","type":"text"},
    {"id":"v2","name":"anomaly","label":"The anomaly or unexpected pattern observed","type":"textarea"},
    {"id":"v3","name":"context","label":"Relevant context (time period, events, data collection method)","type":"textarea"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Investigate anomaly","model":"gemini-2.5-flash","temperature":0.3,"content":"Investigate the following data anomaly in {{data_description}}.\n\nAnomaly observed:\n{{anomaly}}\n\nContext:\n{{context}}\n\nProvide:\n1. **Possible explanations** — list all plausible causes (data quality issues, real-world events, methodology artefacts, seasonal factors, etc.)\n2. **Most likely explanation** — your top hypothesis with reasoning\n3. **How to verify** — specific checks or tests to confirm or rule out each explanation\n4. **Impact assessment** — does this anomaly affect conclusions drawn from the data?\n5. **Recommended next steps**"}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Hypothesis Generator',
  'Generates testable research hypotheses from a business question or observation.',
  'Data & Research',
  ARRAY['research', 'hypotheses', 'experimentation'],
  '[
    {"id":"v1","name":"observation_or_question","label":"Observation or business question","type":"textarea"},
    {"id":"v2","name":"domain","label":"Domain or context","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Generate hypotheses","model":"gemini-2.5-flash","temperature":0.5,"content":"Generate testable research hypotheses for the following observation or question in {{domain}}:\n\n{{observation_or_question}}\n\nFor each hypothesis:\n- State it in the format: ''If [independent variable], then [dependent variable], because [rationale]''\n- Explain the underlying assumption\n- Describe how it could be tested (experiment, A/B test, analysis method)\n- Note what would falsify it\n- Rate testability (easy / moderate / difficult)\n\nGenerate at least 5 hypotheses covering different causal explanations. Include at least one null hypothesis."}
  ]'::jsonb,
  NULL, 0, true
),

(
  'Literature Review',
  'Synthesises research findings into a structured literature review.',
  'Data & Research',
  ARRAY['literature review', 'research', 'synthesis'],
  '[
    {"id":"v1","name":"research_topic","label":"Research topic","type":"text"},
    {"id":"v2","name":"papers_or_findings","label":"Summaries of papers or key findings","type":"textarea"},
    {"id":"v3","name":"research_question","label":"Your research question","type":"text"}
  ]'::jsonb,
  '[
    {"id":"s1","title":"Synthesise findings","model":"gemini-2.5-flash","temperature":0.3,"content":"Synthesise the following research findings on ''{{research_topic}}'' in relation to the research question: {{research_question}}\n\nFindings:\n{{papers_or_findings}}\n\nIdentify: areas of consensus, areas of debate or contradiction, gaps in the literature, and the most relevant and robust findings for the research question."},
    {"id":"s2","title":"Write literature review","model":"gemini-2.5-flash","temperature":0.4,"includePreviousResult":true,"content":"Write a structured literature review on ''{{research_topic}}'' addressing the research question: {{research_question}}\n\nFormat:\n1. Introduction (scope and structure of the review)\n2. Key themes (2-4 thematic sections grouping related findings)\n3. Debates and contradictions in the literature\n4. Gaps and limitations\n5. Synthesis and conclusions (what the literature collectively says about the research question)\n\nWrite in academic style. Attribute findings to sources where named in the input."}
  ]'::jsonb,
  NULL, 0, true
);
