-- ============================================================
-- SQEM-106 — Marketplace: kind dimension + starter seed
-- ============================================================

-- 1. Add the kind dimension + kind-specific fields to mirror the unified prompts model.
ALTER TABLE public.library_templates
  ADD COLUMN IF NOT EXISTS kind               text NOT NULL DEFAULT 'prompt',
  ADD COLUMN IF NOT EXISTS system_instruction text,
  ADD COLUMN IF NOT EXISTS brand_config       jsonb;

ALTER TABLE public.library_templates
  DROP CONSTRAINT IF EXISTS library_templates_kind_check;
ALTER TABLE public.library_templates
  ADD CONSTRAINT library_templates_kind_check CHECK (kind IN ('prompt', 'assistant', 'skill'));

-- 2. Seed 21 curated starter templates (3 per category, mixed kinds).
--    Only seeds when the marketplace is empty, so it never duplicates admin content.
DO $seed$
BEGIN
  IF (SELECT count(*) FROM public.library_templates) = 0 THEN
    INSERT INTO public.library_templates (kind, title, description, category, tags, variables, steps, system_instruction, brand_config, published)
    VALUES
    -- ===== Marketing & Sales =====
    ('prompt', 'Cold Outreach Email', 'Personalized, low-pressure cold email that leads with the customer outcome.', 'Marketing & Sales',
      ARRAY['sales','email','outreach'],
      '[{"id":"v1","name":"prospect_name","label":"Prospect name","type":"text"},{"id":"v2","name":"company","label":"Company","type":"text"},{"id":"v3","name":"value_prop","label":"Value proposition","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"Cold Outreach Email","model":"","includePreviousResult":false,"content":"Write a short, personalized cold outreach email to {{prospect_name}} at {{company}}.\n\nOur value proposition: {{value_prop}}\n\nRules:\n- 90 words max\n- One clear call to action\n- Friendly, not salesy\n- No generic flattery"}]'::jsonb,
      NULL, NULL, true),

    ('assistant', 'Sales Copy Assistant', 'Turns rough product notes into crisp, benefit-led sales copy.', 'Marketing & Sales',
      ARRAY['sales','copywriting'],
      '[]'::jsonb, '[]'::jsonb,
      'You are a senior B2B sales copywriter. You turn rough product notes into crisp, benefit-led copy for emails, landing pages, and outreach. You always lead with the customer outcome, keep sentences short, and cut jargon. When information is missing, you ask one focused question before writing.',
      '{"tone": 3, "brandContext": "", "examples": []}'::jsonb, true),

    ('skill', 'AIDA Copywriting Framework', 'A reusable structure for persuasive marketing copy: Attention, Interest, Desire, Action.', 'Marketing & Sales',
      ARRAY['copywriting','framework'],
      '[]'::jsonb,
      '[{"id":"s1","title":"AIDA Framework","model":"","includePreviousResult":false,"content":"# AIDA Copywriting Framework\n\nWhen writing marketing copy, structure it in four moves:\n\n1. Attention — open with a hook that names the problem the reader has.\n2. Interest — expand with a concrete, relevant detail or number.\n3. Desire — show the outcome and why it matters to them.\n4. Action — end with one unambiguous call to action.\n\nKeep each section tight. Prefer specifics over adjectives."}]'::jsonb,
      NULL, NULL, true),

    -- ===== Writing & Content =====
    ('prompt', 'Blog Post Outline', 'A structured outline with title options, angle, and section notes.', 'Writing & Content',
      ARRAY['writing','blog','seo'],
      '[{"id":"v1","name":"topic","label":"Topic","type":"text"},{"id":"v2","name":"audience","label":"Audience","type":"text"},{"id":"v3","name":"tone","label":"Tone","type":"text","defaultValue":"practical"}]'::jsonb,
      '[{"id":"s1","title":"Blog Post Outline","model":"","includePreviousResult":false,"content":"Create a detailed blog post outline about {{topic}} for {{audience}}.\n\nTone: {{tone}}\n\nInclude:\n- A working title and 2 alternatives\n- A one-sentence angle\n- 5 to 7 H2 sections with a short note on what each covers\n- 3 suggested internal or external link ideas\n- A closing call to action"}]'::jsonb,
      NULL, NULL, true),

    ('skill', 'SEO Meta Description Writer', 'Writes tight, keyword-aware meta descriptions that fit search limits.', 'Writing & Content',
      ARRAY['seo','writing'],
      '[]'::jsonb,
      '[{"id":"s1","title":"Meta Description","model":"","includePreviousResult":false,"content":"# SEO Meta Description\n\nWrite meta descriptions that:\n- Stay between 140 and 155 characters\n- Include the primary keyword once, naturally\n- Describe the concrete benefit of clicking\n- End with a light call to action\n- Avoid quotes and truncation\n\nReturn only the finished description."}]'::jsonb,
      NULL, NULL, true),

    ('assistant', 'Editor-in-Chief', 'A supportive editor that sharpens clarity, flow, and structure.', 'Writing & Content',
      ARRAY['editing','writing'],
      '[]'::jsonb, '[]'::jsonb,
      'You are a demanding but supportive editor-in-chief. You improve clarity, flow, and structure without changing the voice of the author. You flag weak openings, buried leads, passive constructions, and vague claims. You return the edited text first, then a short bullet list of the most important changes.',
      '{"tone": 3, "brandContext": "", "examples": []}'::jsonb, true),

    -- ===== Engineering & Product =====
    ('prompt', 'Code Review Checklist', 'A senior-level review grouped by severity with concrete fixes.', 'Engineering & Product',
      ARRAY['code-review','engineering'],
      '[{"id":"v1","name":"language","label":"Language","type":"text"},{"id":"v2","name":"code","label":"Code to review","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"Code Review","model":"","includePreviousResult":false,"content":"Review the following {{language}} code as a senior engineer.\n\n```\n{{code}}\n```\n\nAssess:\n- Correctness and edge cases\n- Readability and naming\n- Error handling\n- Performance concerns\n- Security issues\n\nReturn findings grouped by severity (blocker, major, minor), each with a concrete suggested fix."}]'::jsonb,
      NULL, NULL, true),

    ('assistant', 'Senior Engineer Pair', 'A pragmatic pair-programmer that explains trade-offs and avoids inventing APIs.', 'Engineering & Product',
      ARRAY['engineering','coding'],
      '[]'::jsonb, '[]'::jsonb,
      'You are a pragmatic senior software engineer pairing with a teammate. You explain trade-offs before giving an answer, prefer simple solutions, and call out risks. You write idiomatic, well-tested code and never invent APIs. When a requirement is ambiguous, you state your assumption and proceed.',
      '{"tone": 2, "brandContext": "", "examples": []}'::jsonb, true),

    ('skill', 'Conventional Commit Messages', 'Formats commit messages using the Conventional Commits standard.', 'Engineering & Product',
      ARRAY['git','engineering'],
      '[]'::jsonb,
      '[{"id":"s1","title":"Conventional Commits","model":"","includePreviousResult":false,"content":"# Conventional Commits\n\nWrite commit messages as: type(scope): summary\n\nTypes: feat, fix, docs, style, refactor, perf, test, chore.\n\nRules:\n- Summary in the imperative mood, under 72 characters\n- No trailing period\n- Add a body only when the change needs context\n- Reference breaking changes with a BREAKING CHANGE footer"}]'::jsonb,
      NULL, NULL, true),

    -- ===== Data & Research =====
    ('prompt', 'Dataset Summary', 'Plain-language read of a dataset plus quality checks and caveats.', 'Data & Research',
      ARRAY['data','analysis'],
      '[{"id":"v1","name":"dataset_description","label":"Dataset description","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"Dataset Summary","model":"","includePreviousResult":false,"content":"You are a data analyst. Given this dataset description:\n\n{{dataset_description}}\n\nProduce:\n- A plain-language summary of what the data represents\n- Likely column types and units\n- Three questions the data could answer\n- Data quality checks to run first\n- One caveat about what the data cannot tell us"}]'::jsonb,
      NULL, NULL, true),

    ('skill', 'Structured Literature Review', 'A consistent template for summarizing and synthesizing sources.', 'Data & Research',
      ARRAY['research','synthesis'],
      '[]'::jsonb,
      '[{"id":"s1","title":"Literature Review","model":"","includePreviousResult":false,"content":"# Structured Literature Review\n\nWhen summarizing sources, for each one capture:\n- Citation and year\n- Core claim in one sentence\n- Method and sample\n- Key finding\n- Limitation\n\nThen synthesize across sources: where they agree, where they conflict, and what remains unanswered. Never overstate certainty."}]'::jsonb,
      NULL, NULL, true),

    ('prompt', 'SQL From a Question', 'Generates a single, explained SQL query from a schema and a plain question.', 'Data & Research',
      ARRAY['sql','data'],
      '[{"id":"v1","name":"schema","label":"Table schema","type":"textarea"},{"id":"v2","name":"question","label":"Question","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"SQL From a Question","model":"","includePreviousResult":false,"content":"Given this schema:\n\n{{schema}}\n\nWrite a single SQL query that answers:\n\n{{question}}\n\nRequirements:\n- Standard SQL\n- Explain the query in one sentence after the code\n- Note any assumption about the data\n- Do not use SELECT *"}]'::jsonb,
      NULL, NULL, true),

    -- ===== Business & Ops =====
    ('prompt', 'Meeting Notes to Action Items', 'Converts raw notes into decisions, owned action items, and open questions.', 'Business & Ops',
      ARRAY['meetings','productivity'],
      '[{"id":"v1","name":"transcript","label":"Notes or transcript","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"Action Items","model":"","includePreviousResult":false,"content":"Turn the following meeting notes into a clear summary.\n\n{{transcript}}\n\nReturn:\n- A 3 bullet summary of decisions\n- A table of action items with owner and due date where stated\n- Open questions that still need an answer\n\nIf an owner or date is missing, mark it as TBD."}]'::jsonb,
      NULL, NULL, true),

    ('assistant', 'Operations Analyst', 'Breaks vague requests into measurable problems and the smallest useful change.', 'Business & Ops',
      ARRAY['operations','analysis'],
      '[]'::jsonb, '[]'::jsonb,
      'You are an operations analyst. You break vague requests into measurable problems, identify the data you would need, and recommend the smallest process change that moves the metric. You quantify impact where possible and always name the assumption behind an estimate.',
      '{"tone": 3, "brandContext": "", "examples": []}'::jsonb, true),

    ('prompt', 'SOP Draft', 'Drafts a clean standard operating procedure from rough steps.', 'Business & Ops',
      ARRAY['process','documentation'],
      '[{"id":"v1","name":"process_name","label":"Process name","type":"text"},{"id":"v2","name":"steps_rough","label":"Rough steps","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"SOP Draft","model":"","includePreviousResult":false,"content":"Write a standard operating procedure for: {{process_name}}\n\nRough steps provided:\n{{steps_rough}}\n\nFormat:\n- Purpose\n- Scope and owner\n- Prerequisites\n- Numbered steps, each starting with a verb\n- Quality checks\n- Common mistakes to avoid"}]'::jsonb,
      NULL, NULL, true),

    -- ===== Support & Success =====
    ('assistant', 'Customer Support Agent', 'A calm, empathetic agent that acknowledges first and gives a clear next step.', 'Support & Success',
      ARRAY['support','customer'],
      '[]'::jsonb, '[]'::jsonb,
      'You are a calm, empathetic customer support agent. You acknowledge the issue first, then give a clear next step. You never blame the customer, avoid jargon, and confirm understanding before closing. If you cannot resolve something, you explain what you will do and by when.',
      '{"tone": 4, "brandContext": "", "examples": []}'::jsonb, true),

    ('prompt', 'Empathetic Response Rewrite', 'Rewrites a support reply to be warm, clear, and action-oriented.', 'Support & Success',
      ARRAY['support','communication'],
      '[{"id":"v1","name":"customer_message","label":"Customer message","type":"textarea"},{"id":"v2","name":"context","label":"Context or resolution","type":"textarea"}]'::jsonb,
      '[{"id":"s1","title":"Response Rewrite","model":"","includePreviousResult":false,"content":"Rewrite a support reply to this customer message:\n\n{{customer_message}}\n\nContext and resolution:\n{{context}}\n\nThe reply should:\n- Open by acknowledging the frustration\n- Give the solution in plain steps\n- Stay warm and concise\n- End with a genuine offer to help further"}]'::jsonb,
      NULL, NULL, true),

    ('skill', 'Ticket Triage and Tagging', 'Classifies incoming tickets by category, priority, and sentiment.', 'Support & Success',
      ARRAY['support','triage'],
      '[]'::jsonb,
      '[{"id":"s1","title":"Ticket Triage","model":"","includePreviousResult":false,"content":"# Ticket Triage\n\nFor each incoming ticket, decide:\n- Category (billing, bug, how-to, feature request, account)\n- Priority (P1 outage, P2 blocked, P3 normal, P4 low)\n- Sentiment (angry, neutral, happy)\n- Whether it needs escalation\n\nReturn a compact tag line, then a one sentence reason for the priority."}]'::jsonb,
      NULL, NULL, true),

    -- ===== Creative & Design =====
    ('prompt', 'Image Prompt Builder', 'Builds a rich text-to-image prompt plus a negative prompt.', 'Creative & Design',
      ARRAY['image','prompt','design'],
      '[{"id":"v1","name":"subject","label":"Subject","type":"text"},{"id":"v2","name":"style","label":"Style","type":"text"},{"id":"v3","name":"mood","label":"Mood","type":"text"}]'::jsonb,
      '[{"id":"s1","title":"Image Prompt","model":"","includePreviousResult":false,"content":"Build a detailed text-to-image prompt.\n\nSubject: {{subject}}\nStyle: {{style}}\nMood: {{mood}}\n\nReturn one rich prompt that specifies composition, lighting, color palette, camera or medium, and level of detail. Then add a short negative prompt of things to avoid."}]'::jsonb,
      NULL, NULL, true),

    ('skill', 'Brand Color Palette Rationale', 'Proposes an accessible brand palette with reasoning for each color.', 'Creative & Design',
      ARRAY['branding','design'],
      '[]'::jsonb,
      '[{"id":"s1","title":"Color Palette","model":"","includePreviousResult":false,"content":"# Brand Color Palette\n\nWhen proposing a palette, provide:\n- One primary, one secondary, and two accent colors as hex values\n- The emotion or association each color carries\n- A note on contrast and accessibility (WCAG AA)\n- A do and a do-not for usage\n\nKeep the palette coherent and limited."}]'::jsonb,
      NULL, NULL, true),

    ('assistant', 'Creative Director', 'Turns a brief into a single distinctive concept before execution.', 'Creative & Design',
      ARRAY['creative','strategy'],
      '[]'::jsonb, '[]'::jsonb,
      'You are a creative director. You turn a brief into a clear concept before any execution. You give direction on tone, visual language, and the single idea that should land. You push for distinctiveness and cut anything generic. You explain the reasoning behind each creative choice.',
      '{"tone": 3, "brandContext": "", "examples": []}'::jsonb, true);
  END IF;
END
$seed$;
