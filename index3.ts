import {
    PDFLoader
} from "@langchain/community/document_loaders/fs/pdf";
import {
    HuggingFaceInferenceEmbeddings
} from "@langchain/community/embeddings/hf";
import {
    ChatMessageHistory
} from "@langchain/community/stores/message/in_memory";
import {
    FaissStore
} from "@langchain/community/vectorstores/faiss";
import {
    Document
} from "@langchain/core/documents";
import {
    SystemMessage
} from "@langchain/core/messages";
import {
    JsonOutputParser
} from "@langchain/core/output_parsers";
import {
    ChatPromptTemplate,
    MessagesPlaceholder
} from "@langchain/core/prompts";
import {
    RunnableMap,
    RunnableSequence,
    RunnableWithMessageHistory
} from "@langchain/core/runnables";
import {
    ChatGroq
} from "@langchain/groq";
import {
    RecursiveCharacterTextSplitter
} from "@langchain/textsplitters";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import {
    systemTemplate
} from "./services/template";

dotenv.config();

// Define output interface
interface IOutput {
  details: string;
  numeric_value: number | null;
  visualization_suggestions: {
    type: 'bar' | 'line' | 'pie' | 'scatter' | 'table' | 'heatmap' | 'histogram' | 'boxplot' | 'area' | 'radar';
    description: string;
    data: {
      labels: string[];
      values: number[];
    };
  }[];
}

type ChainInput = {
  input: string;
  history?: Array<any>;
};

type ChainContext = {
  input: string;
  context: string;
  history?: Array<any>;
};

const FAISS_INDEX_PATH = './data/faiss/faiss.index';

const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGING_FACE_API_KEY!,
});

const chatModel = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY!,
  model: "Llama3-8b-8192",
  temperature: 0.7,
});

// Load PDF and return its content
async function loadPDF(filePath: string): Promise<Document> {
  console.log('📄 Loading PDF...');
  const loader = new PDFLoader(filePath);
  const docs = await loader.load();
  return docs[0];
}

// Split large document into smaller chunks
async function splitDocs(text: string): Promise<string[]> {
  console.log('✂️ Splitting docs...');
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  return await textSplitter.splitText(text);
}

// Embed and save to FAISS
async function embedAndStore(docs: Document[]): Promise<void> {
  console.log('📥 Embedding and storing docs...');
  const store = await FaissStore.fromDocuments(docs, embeddings);
  await store.save(FAISS_INDEX_PATH);
}

// Retrieve from FAISS
async function getRetriever() {
  console.log('🔍 Loading retriever from FAISS...');
  const store = await FaissStore.load(FAISS_INDEX_PATH, embeddings);
  return store.asRetriever(2);
}

// Prepare retriever: either from existing index or PDF
async function pdfProcess() {
  const fullPath = path.resolve(FAISS_INDEX_PATH);

  if (fs.existsSync(fullPath)) {
    console.log('✅ FAISS index found.');
    return await getRetriever();
  }

  console.log('❌ FAISS index not found. Processing PDF...');
  const doc = await loadPDF('./data/s.pdf');
  const splitText = await splitDocs(doc.pageContent);
  const documents = splitText.map((text: string) =>
    new Document({
      pageContent: text,
      metadata: doc.metadata,
    })
  );
  await embedAndStore(documents);
  return await getRetriever();
}

// Clean the raw JSON-like string output from the model
function cleanJsonString(jsonString: string): string {
    return jsonString
      .replace(/\.\.\./g, '') // Remove ellipses
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
      .replace(/,\s*,/g, ',') // Remove double commas
      .replace(/\[\s*,/g, '[') // Remove comma after opening bracket
      .replace(/,\s*\]/g, ']'); // Remove comma before closing bracket
  }
  
  

// Build the full RAG chain
async function createRAGChain(retriever: any): Promise<RunnableSequence<ChainInput, IOutput>> {
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemTemplate],
    new MessagesPlaceholder("history"),
    ["human", "Relevant Context: {context}\n\nQuestion: {input}"],
  ]);

  return RunnableSequence.from<ChainInput, IOutput>([
    RunnableMap.from<ChainInput, ChainContext>({
      input: (input) => input.input,
      history: (input) => input.history || [],
      context: async (input: ChainInput) => {
        const docs = await retriever.invoke(input.input);
        return docs.map((doc: Document) => doc.pageContent).join("\n\n---\n\n");
      },
    }),
    prompt,
    chatModel,
    async (rawOutput: any) => {
      try {
        const content = rawOutput.content || rawOutput;
        const cleanedContent = cleanJsonString(content);
        const parsed = await new JsonOutputParser<IOutput>().invoke(cleanedContent);
        return parsed;
      } catch (err) {
        console.error("❌ JSON parsing error:", err);
        console.error("🧾 Model raw output:", JSON.stringify(rawOutput, null, 2));

        if (err instanceof Error) {
          throw new Error(`Failed to parse JSON: ${err.message}`);
        } else if (typeof err === "string") {
          throw new Error(`Failed to parse JSON: ${err}`);
        } else {
          throw new Error("Failed to parse JSON: Unknown error occurred");
        }
      }
    },
  ]);
}

// Entry point
async function main() {
  try {
    const retriever = await pdfProcess();
    console.log('✅ PDF processing done.');

    const ragChain = await createRAGChain(retriever);
    const messageHistory = new ChatMessageHistory();
    await messageHistory.addMessage(new SystemMessage(systemTemplate));

    const chainWithMemory = new RunnableWithMessageHistory({
      runnable: ragChain,
      getMessageHistory: async () => messageHistory,
      inputMessagesKey: "input",
      historyMessagesKey: "history",
    });

    const sessionId = "user123";

    const response1 = await chainWithMemory.invoke(
      { input: "give me chart data for gp company stock price, bar chart, line chart?" },
      { configurable: { sessionId } }
    );
    console.log("📊 Response 1:", response1);

    console.log('<===============start 2=========>');

    const response2 = await chainWithMemory.invoke(
      { input: "Tell me total number listed company DSE in BD stock market?" },
      { configurable: { sessionId } }
    );
    console.log("📈 Response 2:", response2);

  } catch (error) {
    console.error("🔥 Error in main:", error instanceof Error ? error.message : 'Unknown error occurred');
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error instanceof Error ? error.message : 'Unknown error occurred');
});
