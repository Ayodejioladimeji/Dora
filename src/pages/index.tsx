
export default function Home() {
  return (
    <div
      className={`grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20`}
    >
      <h2>Lynx - Website Broken Link Analyzer</h2>
    </div>
  );
}


// Step 1: Submit the task
// const submitRes = await fetch('/api/a2a', {
//   method: 'POST',
//   body: JSON.stringify({
//     jsonrpc: '2.0',
//     method: 'tasks/submit',
//     params: { url: 'https://example.com' },
//     id: '1'
//   }),
//   headers: { 'Content-Type': 'application/json' }
// });

// const { result: { taskId } } = await submitRes.json();

// // Step 2: Poll task status every 2 seconds
// const interval = setInterval(async () => {
//   const statusRes = await fetch('/api/a2a', {
//     method: 'POST',
//     body: JSON.stringify({
//       jsonrpc: '2.0',
//       method: 'tasks/get',
//       params: { taskId },
//       id: '2'
//     }),
//     headers: { 'Content-Type': 'application/json' }
//   });

//   const data = await statusRes.json();
//   const state = data?.result?.state;

//   if (state === 'completed') {
//     clearInterval(interval);
//     console.log('✅ Output:', data.result.output);
//   } else if (['failed', 'canceled', 'rejected', 'unknown'].includes(state)) {
//     clearInterval(interval);
//     console.error('❌ Task error:', state);
//   } else {
//     console.log('⏳ Task still processing:', state);
//   }
// }, 2000);
