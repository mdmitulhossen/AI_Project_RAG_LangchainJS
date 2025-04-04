import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { ChatMessageHistory } from "@langchain/community/stores/message/in_memory";
import { FaissStore } from "@langchain/community/vectorstores/faiss";
import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableMap, RunnableSequence, RunnableWithMessageHistory } from '@langchain/core/runnables';
import { ChatGroq } from "@langchain/groq";
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import dotenv from "dotenv";
dotenv.config();



// Types for our chain
type ChainInput = {
  input: string;
  history?: Array<any>;
};

type ChainContext = {
  input: string;
  context: string;
  history?: Array<any>;
};

const FaissPath = './data/faiss/faiss.index';
const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGING_FACE_API_KEY,
});

const chatModel = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "Llama3-8b-8192",
  temperature: 0.7,
});

// ✅ Load PDF
async function loadPDF(filePath: string): Promise<Document<Record<string, any>>> {
  console.log('PDF Loading...');
  const loader = new PDFLoader(filePath);
  const docs = await loader.load();
  return docs[0];
}

// ✅ Process PDF: Read, Split
async function splitDocs(docs: any): Promise<string[]> {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  return await textSplitter.splitText(docs);
}

// ✅ Store Embeddings in FAISS
async function embedAndStore(docs: Document[]): Promise<void> {
  await FaissStore.fromDocuments(docs, embeddings).then((store) => 
    store.save(FaissPath)
  );
}

// ✅ Retrieve Relevant Data from PDF
async function getRetriever(): Promise<any> {
  const faissLoad = await FaissStore.load(FaissPath, embeddings);
  return faissLoad.asRetriever(2);
}

// ✅ Create the complete RAG chat chain
function createRAGChain(retriever: any) {
    const prompt = ChatPromptTemplate.fromMessages([
        ["system", `You are an expert stock market assistant. Answer questions by:
        1. First using the provided context when relevant
        2. Supplementing with your own knowledge when needed
        3. If context is irrelevant, rely entirely on your knowledge
        4. Never say you don't know - always provide the best answer possible`],
        new MessagesPlaceholder("history"),
        ["human", `Relevant Context: {context}\n\nQuestion: {input}`],
      ]);

  return RunnableSequence.from([
    // Extract and structure inputs
    RunnableMap.from<ChainInput, ChainContext>({
      input: (input) => input.input,
      history: (input) => input.history || [],
      context: async (input: ChainInput) => {
        const docs = await retriever.invoke(input.input);
        return docs.map((doc: Document) => doc.pageContent).join("\n\n---\n\n");
      },
    }),
    // Format with prompt template
    prompt,
    // Call the LLM
    chatModel,
    // Parse output
    new StringOutputParser(),
  ]);
}

async function main() {
  try {
    // Initialize document processing
    const doc = await loadPDF('./data/s.pdf');
    const splitText = await splitDocs(doc?.pageContent);
    const documents = splitText.map((text: string) => new Document({
      pageContent: text,
      metadata: doc?.metadata,
    }));
    
    // Store embeddings
    await embedAndStore(documents);
    const retriever = await getRetriever();
    
    // Create chat chain with memory
    const ragChain = createRAGChain(retriever);
    const messageHistory = new ChatMessageHistory();
    
    const chainWithMemory = new RunnableWithMessageHistory({
      runnable: ragChain,
      getMessageHistory: async (sessionId) => messageHistory,
      inputMessagesKey: "input",
      historyMessagesKey: "history",
    });
    
    // Example conversation
    const sessionId = "user123";
    
    // First question
    const response1 = await chainWithMemory.invoke(
      { input: "What is stock market?" },
      { configurable: { sessionId } }
    );
    console.log("Response 1:", response1);
    
    const resss = await chatModel.invoke('What is stock market?');

    console.log('<===============start=========>');
    console.log(resss.content,'resss=========>');
    // Follow-up question (will remember context)
    const response2 = await chainWithMemory.invoke(
      { input: "What is GDP of bangladesh 2020?" },
      { configurable: { sessionId } }
    );
    // const response2 = await chainWithMemory.invoke(
    //   { input: "Write Key Functions of the Stock Market:" },
    //   { configurable: { sessionId } }
    // );
    console.log("Response 2:", response2);
    
  } catch (error) {
    console.error("Error in main:", error);
  }
}

main().catch(console.error);