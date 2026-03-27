import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createStream } from '@/lib/api';

export default function NewStreamDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createStream({ name, streamKey });
      setName('');
      setStreamKey('');
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogClose onClose={onClose} />
        <DialogHeader>
          <DialogTitle>New Stream</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">Stream name</label>
            <Input
              placeholder="My 24/7 Stream"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">YouTube Stream Key</label>
            <Input
              type="password"
              placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
              value={streamKey}
              onChange={e => setStreamKey(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Find it in YouTube Studio → Go live → Stream
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating...' : 'Create Stream'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
