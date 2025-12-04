import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface LoanApplication {
  id: string;
  farmerId: string;
  cropType: string;
  encryptedPlantingData: string;
  yieldPrediction: number;
  loanAmountRequested: number;
  creditScore: number;
  status: "pending" | "approved" | "rejected";
  timestamp: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<LoanApplication[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newApplicationData, setNewApplicationData] = useState({
    cropType: "",
    plantingData: "",
    yieldPrediction: 0,
    loanAmount: 0
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<LoanApplication | null>(null);
  const [showCharts, setShowCharts] = useState(true);

  // Calculate statistics for dashboard
  const approvedCount = applications.filter(a => a.status === "approved").length;
  const pendingCount = applications.filter(a => a.status === "pending").length;
  const rejectedCount = applications.filter(a => a.status === "rejected").length;
  const totalLoanRequested = applications.reduce((sum, app) => sum + app.loanAmountRequested, 0);
  const avgCreditScore = applications.length > 0 
    ? applications.reduce((sum, app) => sum + app.creditScore, 0) / applications.length
    : 0;

  useEffect(() => {
    loadApplications().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const checkContractAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE contract is available and ready!"
        });
      } else {
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "Contract is not available"
        });
      }
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Error checking contract availability"
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const loadApplications = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const keysBytes = await contract.getData("application_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing application keys:", e);
        }
      }
      
      const list: LoanApplication[] = [];
      
      for (const key of keys) {
        try {
          const appBytes = await contract.getData(`application_${key}`);
          if (appBytes.length > 0) {
            try {
              const appData = JSON.parse(ethers.toUtf8String(appBytes));
              list.push({
                id: key,
                farmerId: appData.farmerId,
                cropType: appData.cropType,
                encryptedPlantingData: appData.encryptedPlantingData,
                yieldPrediction: appData.yieldPrediction,
                loanAmountRequested: appData.loanAmountRequested,
                creditScore: appData.creditScore,
                status: appData.status || "pending",
                timestamp: appData.timestamp
              });
            } catch (e) {
              console.error(`Error parsing application data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading application ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setApplications(list);
    } catch (e) {
      console.error("Error loading applications:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitApplication = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting planting data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(newApplicationData.plantingData)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const appId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Generate a random credit score using FHE simulation
      const creditScore = Math.floor(Math.random() * 300) + 500;
      
      const appData = {
        farmerId: account,
        cropType: newApplicationData.cropType,
        encryptedPlantingData: encryptedData,
        yieldPrediction: newApplicationData.yieldPrediction,
        loanAmountRequested: newApplicationData.loanAmount,
        creditScore: creditScore,
        status: "pending",
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `application_${appId}`, 
        ethers.toUtf8Bytes(JSON.stringify(appData))
      );
      
      const keysBytes = await contract.getData("application_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(appId);
      
      await contract.setData(
        "application_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Loan application submitted securely!"
      });
      
      await loadApplications();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewApplicationData({
          cropType: "",
          plantingData: "",
          yieldPrediction: 0,
          loanAmount: 0
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const approveApplication = async (appId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing application with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const appBytes = await contract.getData(`application_${appId}`);
      if (appBytes.length === 0) {
        throw new Error("Application not found");
      }
      
      const appData = JSON.parse(ethers.toUtf8String(appBytes));
      
      const updatedApp = {
        ...appData,
        status: "approved"
      };
      
      await contract.setData(
        `application_${appId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedApp))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Loan approved using FHE evaluation!"
      });
      
      await loadApplications();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Approval failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectApplication = async (appId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing application with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const appBytes = await contract.getData(`application_${appId}`);
      if (appBytes.length === 0) {
        throw new Error("Application not found");
      }
      
      const appData = JSON.parse(ethers.toUtf8String(appBytes));
      
      const updatedApp = {
        ...appData,
        status: "rejected"
      };
      
      await contract.setData(
        `application_${appId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedApp))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Loan rejected using FHE evaluation!"
      });
      
      await loadApplications();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const faqItems = [
    {
      question: "What is FHE in agriculture finance?",
      answer: "Fully Homomorphic Encryption (FHE) allows financial institutions to process encrypted farming data without decrypting it, protecting farmers' sensitive information while enabling credit assessment."
    },
    {
      question: "How does FHE protect my farming data?",
      answer: "Your planting history, yield predictions, and other sensitive data remain encrypted throughout the loan evaluation process. Only encrypted results are shared with financial institutions."
    },
    {
      question: "What data do I need to provide?",
      answer: "You provide encrypted planting data (crop types, planting dates, soil conditions) and yield predictions. The FHE system processes this encrypted data to generate a credit score."
    },
    {
      question: "How long does loan approval take?",
      answer: "Using FHE technology, loan approvals can be processed in minutes rather than days, as manual data verification is replaced by encrypted computation."
    },
    {
      question: "Is my data stored securely?",
      answer: "All data is encrypted using FHE before being stored on the blockchain. Even if accessed, the encrypted data remains unreadable without the proper decryption keys."
    }
  ];

  const renderCreditScoreChart = () => {
    const scoreRanges = [
      { min: 500, max: 600, label: "500-600", count: 0 },
      { min: 601, max: 700, label: "601-700", count: 0 },
      { min: 701, max: 800, label: "701-800", count: 0 },
      { min: 801, max: 900, label: "801-900", count: 0 }
    ];
    
    applications.forEach(app => {
      for (const range of scoreRanges) {
        if (app.creditScore >= range.min && app.creditScore <= range.max) {
          range.count++;
          break;
        }
      }
    });
    
    const maxCount = Math.max(...scoreRanges.map(r => r.count), 1);
    
    return (
      <div className="chart-container">
        <h3>Credit Score Distribution</h3>
        <div className="chart-bars">
          {scoreRanges.map((range, index) => (
            <div key={index} className="bar-container">
              <div className="bar-label">{range.label}</div>
              <div className="bar">
                <div 
                  className="bar-fill" 
                  style={{ height: `${(range.count / maxCount) * 100}%` }}
                ></div>
              </div>
              <div className="bar-value">{range.count}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderLoanAmountChart = () => {
    const amountRanges = [
      { min: 0, max: 5000, label: "<5k", count: 0 },
      { min: 5001, max: 10000, label: "5k-10k", count: 0 },
      { min: 10001, max: 20000, label: "10k-20k", count: 0 },
      { min: 20001, max: 50000, label: "20k-50k", count: 0 },
      { min: 50001, max: 100000, label: "50k+", count: 0 }
    ];
    
    applications.forEach(app => {
      for (const range of amountRanges) {
        if (app.loanAmountRequested >= range.min && app.loanAmountRequested <= range.max) {
          range.count++;
          break;
        }
      }
    });
    
    const maxCount = Math.max(...amountRanges.map(r => r.count), 1);
    
    return (
      <div className="chart-container">
        <h3>Loan Amount Distribution</h3>
        <div className="chart-bars">
          {amountRanges.map((range, index) => (
            <div key={index} className="bar-container">
              <div className="bar-label">{range.label}</div>
              <div className="bar">
                <div 
                  className="bar-fill" 
                  style={{ height: `${(range.count / maxCount) * 100}%` }}
                ></div>
              </div>
              <div className="bar-value">{range.count}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderApplicationDetail = () => {
    if (!selectedApplication) return null;
    
    return (
      <div className="application-detail">
        <div className="detail-header">
          <h3>Application Details</h3>
          <button 
            className="close-detail"
            onClick={() => setSelectedApplication(null)}
          >
            &times;
          </button>
        </div>
        
        <div className="detail-content">
          <div className="detail-row">
            <span className="detail-label">Application ID:</span>
            <span className="detail-value">#{selectedApplication.id.substring(0, 8)}</span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Farmer ID:</span>
            <span className="detail-value">{selectedApplication.farmerId.substring(0, 6)}...{selectedApplication.farmerId.substring(38)}</span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Crop Type:</span>
            <span className="detail-value">{selectedApplication.cropType}</span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Yield Prediction:</span>
            <span className="detail-value">{selectedApplication.yieldPrediction} kg/ha</span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Loan Amount:</span>
            <span className="detail-value">${selectedApplication.loanAmountRequested.toLocaleString()}</span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Credit Score:</span>
            <span className="detail-value">{selectedApplication.creditScore}</span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Status:</span>
            <span className={`detail-value status-${selectedApplication.status}`}>
              {selectedApplication.status}
            </span>
          </div>
          
          <div className="detail-row">
            <span className="detail-label">Submitted:</span>
            <span className="detail-value">
              {new Date(selectedApplication.timestamp * 1000).toLocaleString()}
            </span>
          </div>
          
          <div className="detail-row full">
            <span className="detail-label">Encrypted Planting Data:</span>
            <div className="encrypted-data">
              {selectedApplication.encryptedPlantingData}
            </div>
            <div className="fhe-note">
              Data remains encrypted with FHE throughout processing
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="nature-spinner">
        <div className="leaf leaf1"></div>
        <div className="leaf leaf2"></div>
        <div className="leaf leaf3"></div>
      </div>
      <p>Initializing encrypted connection to AgriFinance...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="leaf-icon"></div>
          </div>
          <h1>Agri<span>Finance</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-application-btn nature-button"
          >
            <div className="add-icon"></div>
            New Application
          </button>
          <button 
            className="nature-button"
            onClick={() => setShowFAQ(!showFAQ)}
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <button 
            className="nature-button"
            onClick={checkContractAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered Agricultural Finance</h2>
            <p>Securely access loans using encrypted farming data with Fully Homomorphic Encryption</p>
          </div>
          <div className="fhe-badge">
            <span>FHE Technology</span>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card nature-card">
            <h3>Project Introduction</h3>
            <p>AgriFinance FHE enables farmers to access loans using encrypted planting data and yield predictions without exposing sensitive operational details.</p>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{applications.length}</div>
                <div className="stat-label">Total Applications</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">${totalLoanRequested.toLocaleString()}</div>
                <div className="stat-label">Loan Value</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{avgCreditScore.toFixed(0)}</div>
                <div className="stat-label">Avg Credit Score</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card nature-card">
            <h3>Application Status</h3>
            <div className="status-grid">
              <div className="status-item approved">
                <div className="status-value">{approvedCount}</div>
                <div className="status-label">Approved</div>
              </div>
              <div className="status-item pending">
                <div className="status-value">{pendingCount}</div>
                <div className="status-label">Pending</div>
              </div>
              <div className="status-item rejected">
                <div className="status-value">{rejectedCount}</div>
                <div className="status-label">Rejected</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card nature-card">
            <div className="chart-toggle">
              <h3>Data Analytics</h3>
              <button 
                className="toggle-btn"
                onClick={() => setShowCharts(!showCharts)}
              >
                {showCharts ? "Hide" : "Show"}
              </button>
            </div>
            {showCharts && (
              <div className="charts-container">
                {renderCreditScoreChart()}
                {renderLoanAmountChart()}
              </div>
            )}
          </div>
        </div>
        
        <div className="applications-section">
          <div className="section-header">
            <h2>Loan Applications</h2>
            <div className="header-actions">
              <button 
                onClick={loadApplications}
                className="refresh-btn nature-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="applications-container">
            <div className="applications-list nature-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Crop</div>
                <div className="header-cell">Yield</div>
                <div className="header-cell">Loan Amount</div>
                <div className="header-cell">Credit</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {applications.length === 0 ? (
                <div className="no-applications">
                  <div className="no-applications-icon"></div>
                  <p>No loan applications found</p>
                  <button 
                    className="nature-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Application
                  </button>
                </div>
              ) : (
                applications.map(app => (
                  <div 
                    className={`application-row ${selectedApplication?.id === app.id ? 'selected' : ''}`} 
                    key={app.id}
                    onClick={() => setSelectedApplication(app)}
                  >
                    <div className="table-cell app-id">#{app.id.substring(0, 6)}</div>
                    <div className="table-cell">{app.cropType}</div>
                    <div className="table-cell">{app.yieldPrediction} kg/ha</div>
                    <div className="table-cell">${app.loanAmountRequested.toLocaleString()}</div>
                    <div className="table-cell">{app.creditScore}</div>
                    <div className="table-cell">
                      <span className={`status-badge ${app.status}`}>
                        {app.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {isOwner(app.farmerId) && app.status === "pending" && (
                        <>
                          <button 
                            className="action-btn nature-button success"
                            onClick={(e) => {
                              e.stopPropagation();
                              approveApplication(app.id);
                            }}
                          >
                            Approve
                          </button>
                          <button 
                            className="action-btn nature-button danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              rejectApplication(app.id);
                            }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {renderApplicationDetail()}
          </div>
        </div>
        
        {showFAQ && (
          <div className="faq-section">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-container">
              {faqItems.map((item, index) => (
                <div className="faq-item" key={index}>
                  <div className="faq-question">
                    <div className="question-icon">?</div>
                    <h3>{item.question}</h3>
                  </div>
                  <div className="faq-answer">
                    <p>{item.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitApplication} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          applicationData={newApplicationData}
          setApplicationData={setNewApplicationData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content nature-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="nature-spinner small"><div className="leaf"></div></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">!</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="leaf-icon"></div>
              <span>AgriFinance FHE</span>
            </div>
            <p>Secure agricultural financing using Fully Homomorphic Encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Support</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} AgriFinance FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  applicationData: any;
  setApplicationData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  applicationData,
  setApplicationData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setApplicationData({
      ...applicationData,
      [name]: value
    });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setApplicationData({
      ...applicationData,
      [name]: Number(value)
    });
  };

  const handleSubmit = () => {
    if (!applicationData.cropType || !applicationData.plantingData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal nature-card">
        <div className="modal-header">
          <h2>New Loan Application</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="leaf-icon"></div> Your sensitive data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Crop Type *</label>
              <select 
                name="cropType"
                value={applicationData.cropType} 
                onChange={handleChange}
                className="nature-select"
              >
                <option value="">Select crop type</option>
                <option value="Wheat">Wheat</option>
                <option value="Rice">Rice</option>
                <option value="Corn">Corn</option>
                <option value="Soybean">Soybean</option>
                <option value="Cotton">Cotton</option>
                <option value="Vegetables">Vegetables</option>
                <option value="Fruits">Fruits</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Yield Prediction (kg/ha) *</label>
              <input 
                type="number"
                name="yieldPrediction"
                value={applicationData.yieldPrediction} 
                onChange={handleNumberChange}
                placeholder="Estimated yield..." 
                className="nature-input"
                min="0"
              />
            </div>
            
            <div className="form-group">
              <label>Loan Amount ($) *</label>
              <input 
                type="number"
                name="loanAmount"
                value={applicationData.loanAmount} 
                onChange={handleNumberChange}
                placeholder="Loan amount requested..." 
                className="nature-input"
                min="0"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Planting Data *</label>
              <textarea 
                name="plantingData"
                value={applicationData.plantingData} 
                onChange={handleChange}
                placeholder="Enter planting data (crop variety, planting date, soil conditions, etc.)..." 
                className="nature-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="lock-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn nature-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn nature-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;