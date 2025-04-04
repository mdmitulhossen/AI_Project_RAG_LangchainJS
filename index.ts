import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatGroq } from "@langchain/groq";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import "dotenv/config";
import fs from "fs";
import pdf from "pdf-parse";

// ✅ LLM Model (Groq)
const llm = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY!,
  model: "llama3-8b-8192",
  temperature: 0.7,
});

// ✅ Embeddings Model (HuggingFace)
const embeddings = new HuggingFaceInferenceEmbeddings({
    // apiKey: process.env.HUGGINGFACE_API_KEY!,
  model: "sentence-transformers/all-MiniLM-L6-v2",
});

// ✅ Memory (BufferMemory)
// const memory = new BufferMemory({
//   chatHistory: new ChatMessageHistory(),
// });

// ✅ Web Search (SerpAPI)
// const webSearch = new SerpAPI(process.env.SERPAPI_KEY!);

async function loadPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text;
}

// ✅ Process PDF: Read, Split, Store in FAISS
async function processPDF(filePath: string) {
  const text = await loadPDF(filePath);
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 100 });
  const chunks = await splitter.splitText(text);
  const faiss = await FaissStore.fromTexts(chunks, chunks.map(() => ({})), embeddings);
  await faiss.save("faiss.index");
}

// ✅ Retrieve Relevant Data from PDF
async function retrieveFromPDF(query: string) {
  try {
    const faiss = await FaissStore.load("faiss.index", embeddings);
    const relevantDocs = await faiss.similaritySearch(query, 5);
    return relevantDocs.map((doc) => doc.pageContent).join("\n");
  } catch (error) {
    console.error("FAISS Load Error:", error);
    return "";
  }
}

// ✅ Prompt Template
const promptTemplate = ChatPromptTemplate.fromTemplate(`
প্রশ্ন: {question}

প্রাসঙ্গিক তথ্য:
{context}

উত্তর:
`);

// ✅ Chain Execution
const chain = RunnableSequence.from([
  promptTemplate,
  llm
]);

async function answerFromLLM(question: string, context: string) {
  return await chain.invoke({ question, context });
}

// ✅ Web Search
// async function searchWeb(query: string) {
//   const response = await webSearch.invoke(query);
//   return response;
// }

// ✅ PDF_QA Function
async function pdfQA(question: string) {
  const pdfContext = await retrieveFromPDF(question);

  if (pdfContext) {
    return await answerFromLLM(question, pdfContext);
  }

  // ✅ LLM Response
  const llmResponse = await llm.invoke([{ role: "user", content: question }]);
  const llmContent = Array.isArray(llmResponse.content)
    ? llmResponse.content.map(c => c.toString()).join(" ")
    : llmResponse.content.toString();

//   if (llmContent.toLowerCase().includes("i don't know")) {
//     return await searchWeb(question);
//   }

  return llmContent;
}

// ✅ Main Function
async function main() {
//   await processPDF("./data/stock_market.pdf");
//   const question = "বর্তমানে স্টক মার্কেটের অবস্থা কেমন?";
//   const answer = await pdfQA(question);
//   console.log(`প্রশ্ন: ${question}`);
//   console.log(`উত্তর: ${answer}`);

console.log(1+2,'hello world');
}

main().catch(console.error);
