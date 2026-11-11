'use client';

import type { TemplateCategory } from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { TemplateEditor } from '@/components/catalog/template-editor';
import { useToast } from '@/components/toast';
import { accountApi, ApiError } from '@/lib/api';
import { catalogApi } from '@/lib/catalog';

export default function NewTemplatePage() {
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TemplateCategory>('UTILITY');
  const [language, setLanguage] = useState('en');
  const [body, setBody] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const created = await catalogApi.createTemplate({
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        category,
        language,
        body,
        samples,
      });
      toast('Draft saved.');
      await queryClient.invalidateQueries({ queryKey: ['templates'] });
      router.push(`/dashboard/templates/${created.id}`);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not save the draft.');
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New template</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Leave the name blank to take it from the first line of the message.
        </p>
      </div>
      <TemplateEditor
        name={name}
        category={category}
        language={language}
        body={body}
        samples={samples}
        saving={saving}
        smartEncoding={session.data?.organization?.smartEncoding !== false}
        onChange={(next) => {
          setName(next.name);
          setCategory(next.category);
          setLanguage(next.language);
          setBody(next.body);
          setSamples(next.samples);
        }}
        onSave={() => {
          void save();
        }}
      />
    </section>
  );
}
