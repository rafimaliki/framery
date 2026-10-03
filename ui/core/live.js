// The server-sent-events stream. Three things arrive: what changed on disk (project data, frames),
// a request to reload because the studio's own files changed, and, after the server restarts, the
// stream coming back, which also reloads the page so a restarted studio is never left half old.

export function connect(onChanged) {
  const source = new EventSource('/__events');
  let lost = false;
  source.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'changed') onChanged(event.events);
    else if (event.type === 'reload') location.reload();
  };
  source.onerror = () => {
    lost = true;
  };
  source.onopen = () => {
    if (lost) location.reload();
  };
  return () => source.close();
}
