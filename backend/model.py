import torch.nn as nn
class BlurCNN(nn.Module):
    def __init__(self):
        super().__init__()

        self.conv1=nn.Conv2d(
            in_channels=3,
            out_channels=32,
            kernel_size=3,
            padding=1
        )
        self.pool=nn.MaxPool2d(
            kernel_size=2,
            stride=2
        )
        self.conv2=nn.Conv2d(
            in_channels=32,
            out_channels=64,
            kernel_size=3,
            padding=1
        )
        self.fc1=nn.Linear(64*56*56,256)
        self.fc2=nn.Linear(256,2)
        self.relu=nn.ReLU()
    def forward(self,x):
        x=self.conv1(x)
        #[32,3,224,224]->[32,16,224,224]
        #conv1 have 16 filters which move in 3X3(kernal)
        #detects features and generate 16 feature map
        x=self.relu(x)
        #Rectified Liner Unit f(x)=max(0,x)
        #x>0 keep x<0 make it 0
        #[-2, 5, -1, 7]->[0, 5, 0, 7]
        x=self.pool(x)  #[32,16,112,112]
        #moves across the feature map doing max pooling here

        x=self.conv2(x)
        #learns more complex patterns 
        #16->32 feature map [32,32,112,112]
        x=self.relu(x)
        x=self.pool(x) #[32,32,56,56]

        # flatten [32,32,56,56] to [32,100352]
        x=x.view(x.size(0),-1)

        x=self.fc1(x) #combine important features
        #[32,100352]->[32,128] 
        #each image is now represented by 128 learned features
        x=self.relu(x)
        #-ve to 0
        x=self.fc2(x) #final decison
        #[32,128]->[32,2] 0-1 sharp-blur

        #OUTPUT(32size)
        # [
        #     [2.5, 0.8],
        #     [0.3, 4.1],
        #     .
        #     [1.7, 0.5]
        # ]
        return x
