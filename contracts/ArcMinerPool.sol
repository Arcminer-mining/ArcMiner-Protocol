// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IARCM} from "./interfaces/IARCM.sol";

contract ArcMinerPool {
    IARCM public immutable arcm;
    address payable public immutable feeRecipient;
    uint256 public constant FEE_BPS = 250;
    uint256 public constant BPS = 10_000;
    bool public initialized;

    event LiquidityInitialized(address indexed provider, uint256 nativeAmount, uint256 arcmAmount);
    event Swap(address indexed trader, bool buy, uint256 amountIn, uint256 amountOut, uint256 fee);

    error AlreadyInitialized();
    error NotInitialized();
    error Slippage();
    error TransferFailed();

    constructor(address arcm_, address payable feeRecipient_) {
        arcm = IARCM(arcm_);
        feeRecipient = feeRecipient_;
    }

    receive() external payable {}

    function initialize(uint256 arcmAmount) external payable {
        if (initialized) revert AlreadyInitialized();
        require(msg.value > 0 && arcmAmount > 0, "liquidity");
        require(arcm.transferFrom(msg.sender, address(this), arcmAmount), "token");
        initialized = true;
        emit LiquidityInitialized(msg.sender, msg.value, arcmAmount);
    }

    function reserves() public view returns (uint256 nativeReserve, uint256 arcmReserve) {
        return (address(this).balance, arcm.balanceOf(address(this)));
    }

    function quoteBuy(uint256 nativeIn) public view returns (uint256 out, uint256 fee) {
        if (!initialized) revert NotInitialized();
        uint256 nativeReserve = address(this).balance;
        uint256 tokenReserve = arcm.balanceOf(address(this));
        fee = nativeIn * FEE_BPS / BPS;
        uint256 net = nativeIn - fee;
        out = tokenReserve * net / (nativeReserve + net);
    }

    function buyARCM(uint256 minOut) external payable returns (uint256 out) {
        if (!initialized) revert NotInitialized();
        // balance already includes msg.value, so reconstruct pre-swap reserve.
        uint256 nativeBefore = address(this).balance - msg.value;
        uint256 tokenReserve = arcm.balanceOf(address(this));
        uint256 fee = msg.value * FEE_BPS / BPS;
        uint256 net = msg.value - fee;
        out = tokenReserve * net / (nativeBefore + net);
        if (out < minOut) revert Slippage();
        require(arcm.transfer(msg.sender, out), "token");
        if (fee != 0) {
            (bool ok,) = feeRecipient.call{value: fee}("");
            if (!ok) revert TransferFailed();
        }
        emit Swap(msg.sender, true, msg.value, out, fee);
    }

    function quoteSell(uint256 arcmIn) public view returns (uint256 netOut, uint256 fee) {
        if (!initialized) revert NotInitialized();
        uint256 nativeReserve = address(this).balance;
        uint256 tokenReserve = arcm.balanceOf(address(this));
        uint256 gross = nativeReserve * arcmIn / (tokenReserve + arcmIn);
        fee = gross * FEE_BPS / BPS;
        netOut = gross - fee;
    }

    function sellARCM(uint256 arcmIn, uint256 minNativeOut) external returns (uint256 netOut) {
        if (!initialized) revert NotInitialized();
        uint256 nativeReserve = address(this).balance;
        uint256 tokenBefore = arcm.balanceOf(address(this));
        require(arcm.transferFrom(msg.sender, address(this), arcmIn), "token");
        uint256 gross = nativeReserve * arcmIn / (tokenBefore + arcmIn);
        uint256 fee = gross * FEE_BPS / BPS;
        netOut = gross - fee;
        if (netOut < minNativeOut) revert Slippage();
        (bool feeOk,) = feeRecipient.call{value: fee}("");
        (bool userOk,) = payable(msg.sender).call{value: netOut}("");
        if (!feeOk || !userOk) revert TransferFailed();
        emit Swap(msg.sender, false, arcmIn, netOut, fee);
    }
}
