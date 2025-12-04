// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AgriFinanceFHE is SepoliaConfig {

    struct EncryptedLoanApplication {
        uint256 id;
        euint32 encryptedFarmData;
        euint32 encryptedYieldPrediction;
        euint32 encryptedLoanAmount;
        uint256 timestamp;
    }

    struct DecryptedLoanApplication {
        string farmData;
        string yieldPrediction;
        uint256 recommendedLoan;
        bool isRevealed;
    }

    uint256 public applicationCount;
    mapping(uint256 => EncryptedLoanApplication) public encryptedApplications;
    mapping(uint256 => DecryptedLoanApplication) public decryptedApplications;
    
    mapping(string => euint32) private encryptedLoanCategoryCount;
    string[] private loanCategories;

    mapping(uint256 => uint256) private requestToApplicationId;

    event LoanApplicationSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event ApplicationDecrypted(uint256 indexed id);

    modifier onlyApplicant(uint256 applicationId) {
        _;
    }

    function submitEncryptedLoanApplication(
        euint32 encryptedFarmData,
        euint32 encryptedYieldPrediction,
        euint32 encryptedLoanAmount
    ) public {
        applicationCount += 1;
        uint256 newId = applicationCount;

        encryptedApplications[newId] = EncryptedLoanApplication({
            id: newId,
            encryptedFarmData: encryptedFarmData,
            encryptedYieldPrediction: encryptedYieldPrediction,
            encryptedLoanAmount: encryptedLoanAmount,
            timestamp: block.timestamp
        });

        decryptedApplications[newId] = DecryptedLoanApplication({
            farmData: "",
            yieldPrediction: "",
            recommendedLoan: 0,
            isRevealed: false
        });

        emit LoanApplicationSubmitted(newId, block.timestamp);
    }

    function requestApplicationDecryption(uint256 applicationId) public onlyApplicant(applicationId) {
        EncryptedLoanApplication storage application = encryptedApplications[applicationId];
        require(!decryptedApplications[applicationId].isRevealed, "Already decrypted");

        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(application.encryptedFarmData);
        ciphertexts[1] = FHE.toBytes32(application.encryptedYieldPrediction);
        ciphertexts[2] = FHE.toBytes32(application.encryptedLoanAmount);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptApplication.selector);
        requestToApplicationId[reqId] = applicationId;

        emit DecryptionRequested(applicationId);
    }

    function decryptApplication(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 applicationId = requestToApplicationId[requestId];
        require(applicationId != 0, "Invalid request");

        EncryptedLoanApplication storage eApp = encryptedApplications[applicationId];
        DecryptedLoanApplication storage dApp = decryptedApplications[applicationId];
        require(!dApp.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));

        dApp.farmData = results[0];
        dApp.yieldPrediction = results[1];
        dApp.recommendedLoan = abi.decode(bytes(results[2]), (uint256));
        dApp.isRevealed = true;

        if (!FHE.isInitialized(encryptedLoanCategoryCount[results[1]])) {
            encryptedLoanCategoryCount[results[1]] = FHE.asEuint32(0);
            loanCategories.push(results[1]);
        }
        encryptedLoanCategoryCount[results[1]] = FHE.add(
            encryptedLoanCategoryCount[results[1]],
            FHE.asEuint32(1)
        );

        emit ApplicationDecrypted(applicationId);
    }

    function getDecryptedApplication(uint256 applicationId) public view returns (
        string memory farmData,
        string memory yieldPrediction,
        uint256 recommendedLoan,
        bool isRevealed
    ) {
        DecryptedLoanApplication storage app = decryptedApplications[applicationId];
        return (app.farmData, app.yieldPrediction, app.recommendedLoan, app.isRevealed);
    }

    function getEncryptedLoanCategoryCount(string memory category) public view returns (euint32) {
        return encryptedLoanCategoryCount[category];
    }

    function requestLoanCategoryCountDecryption(string memory category) public {
        euint32 count = encryptedLoanCategoryCount[category];
        require(FHE.isInitialized(count), "Category not found");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptLoanCategoryCount.selector);
        requestToApplicationId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(category)));
    }

    function decryptLoanCategoryCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 categoryHash = requestToApplicationId[requestId];
        string memory category = getCategoryFromHash(categoryHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getCategoryFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < loanCategories.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(loanCategories[i]))) == hash) {
                return loanCategories[i];
            }
        }
        revert("Category not found");
    }
}