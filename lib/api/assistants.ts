import { supabase } from '../supabase';
import type { Prompt } from '../../types';
import { rowToPrompt, type PromptRow } from './prompts';

const ASSISTANT_SELECT = 'id, workspace_id, kind, title, description, tag, steps, content, system_instruction, context_file_ids, skill_ids, model, variables, created_at, updated_at, usage_count, published, source_template_id, created_by';

export async function fetchAssistants(workspaceId: string): Promise<Prompt[]> {
  const { data, error } = await supabase
    .from('prompts')
    .select(ASSISTANT_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('kind', 'assistant')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(row => rowToPrompt(row as unknown as PromptRow));
}

export async function createAssistant(
  assistant: Pick<Prompt, 'title' | 'description' | 'systemInstruction'>,
  workspaceId: string,
): Promise<Prompt> {
  const { data, error } = await supabase
    .from('prompts')
    .insert({
      workspace_id: workspaceId,
      kind: 'assistant',
      title: assistant.title,
      description: assistant.description || '',
      system_instruction: assistant.systemInstruction || null,
      content: '',
      tags: [],
      variables: [],
      context_file_ids: [],
      skill_ids: [],
      usage_count: 0,
    })
    .select();

  if (error) throw error;
  return rowToPrompt(data![0] as unknown as PromptRow);
}

export async function updateAssistant(assistant: Prompt, workspaceId: string): Promise<Prompt> {
  const { data, error } = await supabase
    .from('prompts')
    .update({
      title: assistant.title,
      description: assistant.description,
      system_instruction: assistant.systemInstruction || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assistant.id)
    .select();

  if (error) throw error;
  return rowToPrompt(data![0] as unknown as PromptRow);
}

export async function deleteAssistant(id: string): Promise<void> {
  const { error } = await supabase
    .from('prompts')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function duplicateAssistant(assistant: Prompt, workspaceId: string): Promise<Prompt> {
  return createAssistant(
    {
      title: `${assistant.title} (Copy)`,
      description: assistant.description,
      systemInstruction: assistant.systemInstruction,
    },
    workspaceId,
  );
}
