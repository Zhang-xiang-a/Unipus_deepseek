export function verifyTaskProgress(task,response) {
  const leafId=new URL(task.url).hash.split('/').at(-1);
  const leaf=response?.code===0?response.rt?.leafs?.[leafId]:null;
  return {leafId,courseCompletionVerified:!!leaf && [1,2].includes(leaf.state?.pass),
    state:leaf?.state ?? null,required:leaf?.strategies?.required ?? null};
}
